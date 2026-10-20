import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemRole } from '@prisma/client';

import { AuditService } from '../audit/audit.service.js';
import { isMfaExempt } from '../auth/mfa-exemption.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type MfaAdminState = {
  enabled: boolean;
  exempt: boolean;
  exemptUntil: string | null;
};

/**
 * Gestión del 2FA de otros usuarios por un SUPER_ADMIN: restablecer el
 * autenticador (perdió el teléfono) o eximirlo temporal o indefinidamente.
 * Nunca sobre la propia cuenta, y a otro SUPER_ADMIN solo se le puede
 * restablecer: su rol exige 2FA.
 */
@Injectable()
export class UserMfaAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Borra el autenticador y los dispositivos de confianza. */
  async reset(actor: JwtPayload, targetId: string): Promise<MfaAdminState> {
    const target = await this.loadTarget(actor, targetId);
    await this.prisma.$transaction(async (tx) => {
      await tx.totpSecret.deleteMany({ where: { userId: targetId } });
      await tx.trustedDevice.deleteMany({ where: { userId: targetId } });
    });
    await this.audit.log({
      userId: actor.sub,
      action: 'TOTP_DISABLE',
      entity: 'User',
      entityId: targetId,
      meta: { mode: 'admin_reset', targetEmail: target.email },
    });
    this.notify(
      target,
      'Un administrador restableció la verificación en dos pasos de tu cuenta. ' +
        'Si tu rol la exige, la configurarás de nuevo al iniciar sesión; si no, ' +
        'puedes volver a activarla desde tu Perfil.',
    );
    return { enabled: false, exempt: isMfaExempt(target), exemptUntil: this.iso(target) };
  }

  /** Exime del 2FA hasta `until` (o indefinidamente si es null). No borra nada. */
  async setExemption(
    actor: JwtPayload,
    targetId: string,
    input: { until: Date | null; reason?: string },
  ): Promise<MfaAdminState> {
    const target = await this.loadTarget(actor, targetId);
    if (target.schoolRoles.some((r) => r.role === SystemRole.SUPER_ADMIN)) {
      throw new ForbiddenException(
        'Un Super admin no puede quedar sin verificación en dos pasos. Restablécela en su lugar.',
      );
    }
    if (input.until && input.until <= new Date()) {
      throw new BadRequestException('La fecha de término debe ser futura');
    }
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        mfaExemptAt: new Date(),
        mfaExemptUntil: input.until,
        mfaExemptById: actor.sub,
        mfaExemptReason: input.reason?.trim() || null,
      },
      select: { mfaExemptAt: true, mfaExemptUntil: true },
    });
    await this.audit.log({
      userId: actor.sub,
      action: 'TOTP_DISABLE',
      entity: 'User',
      entityId: targetId,
      meta: {
        mode: 'admin_exemption',
        targetEmail: target.email,
        until: input.until?.toISOString() ?? null,
        reason: input.reason?.trim() || null,
      },
    });
    this.notify(
      target,
      input.until
        ? `Un administrador desactivó la verificación en dos pasos de tu cuenta hasta el ${input.until.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}. Después se volverá a pedir.`
        : 'Un administrador desactivó la verificación en dos pasos de tu cuenta hasta nuevo aviso.',
    );
    return {
      enabled: target.totpSecrets.some((t) => t.verified),
      exempt: isMfaExempt(updated),
      exemptUntil: updated.mfaExemptUntil?.toISOString() ?? null,
    };
  }

  /** Quita la exención: el autenticador que tuviera se vuelve a pedir. */
  async clearExemption(actor: JwtPayload, targetId: string): Promise<MfaAdminState> {
    const target = await this.loadTarget(actor, targetId);
    await this.prisma.user.update({
      where: { id: targetId },
      data: { mfaExemptAt: null, mfaExemptUntil: null, mfaExemptById: null, mfaExemptReason: null },
      select: { id: true },
    });
    await this.audit.log({
      userId: actor.sub,
      action: 'TOTP_ENABLE',
      entity: 'User',
      entityId: targetId,
      meta: { mode: 'admin_exemption_revoked', targetEmail: target.email },
    });
    this.notify(target, 'Un administrador reactivó la verificación en dos pasos de tu cuenta.');
    return {
      enabled: target.totpSecrets.some((t) => t.verified),
      exempt: false,
      exemptUntil: null,
    };
  }

  private async loadTarget(actor: JwtPayload, targetId: string) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Solo Super admin puede gestionar la verificación en dos pasos');
    }
    if (actor.sub === targetId) {
      throw new BadRequestException('Gestiona tu propia verificación en dos pasos desde tu Perfil');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        deletedAt: true,
        mfaExemptAt: true,
        mfaExemptUntil: true,
        schoolRoles: { select: { role: true } },
        totpSecrets: { select: { verified: true } },
      },
    });
    if (!target || target.deletedAt) throw new NotFoundException('Usuario no encontrado');
    return target;
  }

  private iso(target: { mfaExemptUntil: Date | null }): string | null {
    return target.mfaExemptUntil?.toISOString() ?? null;
  }

  private notify(target: { email: string; firstName: string; lastName: string }, text: string) {
    void this.mail
      .enqueue({
        to: { email: target.email, name: `${target.firstName} ${target.lastName}` },
        subject: 'Cambio en la verificación en dos pasos de tu cuenta',
        html: `<p>Hola ${target.firstName},</p><p>${text}</p><p>Si no reconoces este cambio, avisa de inmediato a la administración del colegio.</p>`,
        text: `Hola ${target.firstName},\n${text}\nSi no reconoces este cambio, avisa de inmediato a la administración del colegio.`,
        category: 'SYSTEM',
        priority: 'HIGH',
      })
      .catch(() => undefined);
  }
}
