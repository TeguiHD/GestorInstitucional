import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './services/password.service.js';
import { TokenService, type TokenPair } from './services/token.service.js';
import { TotpService } from './services/totp.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { ROLES_REQUIRING_2FA } from '@asistencia/shared';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 30;

function formatLockoutMessage(until: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutes} min o contacta al administrador.`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
  ) {}

  async login(
    dto: LoginDto,
    ip?: string,
    ua?: string,
  ): Promise<
    | (TokenPair & { requiresTotp: false; requiresTotpSetup: false; deviceToken?: string })
    | { accessToken: ''; refreshToken: ''; requiresTotp: true; requiresTotpSetup: false }
    | { setupToken: string; requiresTotp: false; requiresTotpSetup: true }
  > {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { schoolRoles: true },
    });

    // Timing-safe: always run hash even on missing user
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashvaluedummyhashvaluedummyhash';
    const passwordValid = user
      ? await this.passwords.verify(user.passwordHash, dto.password)
      : await this.passwords.verify(dummyHash, dto.password).then(() => false);

    if (!user || !passwordValid || user.deletedAt) {
      if (user) {
        await this.handleFailedLogin(user.id, ip);
        await this.audit.log({ userId: user.id, action: 'LOGIN_FAILED', ip, ua });
        const newFailedCount = (user.failedLogins ?? 0) + 1;
        const remaining = Math.max(0, MAX_FAILED_LOGINS - newFailedCount);
        throw new UnauthorizedException({
          message:
            remaining <= 3 && remaining > 0
              ? `Credenciales inválidas · ${remaining} intento${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`
              : 'Credenciales inválidas',
          remainingAttempts: remaining,
        });
      }
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.status === 'LOCKED') {
      const lockExpired = user.lockedUntil && user.lockedUntil < new Date();
      if (!lockExpired) {
        throw new UnauthorizedException(
          user.lockedUntil
            ? formatLockoutMessage(user.lockedUntil)
            : 'Cuenta bloqueada. Contacta al administrador.',
        );
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', failedLogins: 0, lockedUntil: null },
      });
    }

    if (user.status !== 'ACTIVE')
      throw new UnauthorizedException('Cuenta inactiva. Contacta al administrador.');

    // 2FA check
    const totpEnabled = await this.totp.isEnabled(user.id);
    let totpSkipped = false;
    if (totpEnabled) {
      if (dto.deviceToken) {
        totpSkipped = await this.totp.isDeviceTrusted(user.id, dto.deviceToken);
      }
      if (!totpSkipped) {
        if (!dto.totpCode) {
          return {
            accessToken: '' as const,
            refreshToken: '' as const,
            requiresTotp: true,
            requiresTotpSetup: false,
          };
        }
        try {
          await this.totp.validateForLogin(user.id, dto.totpCode);
        } catch (err) {
          // Un código TOTP inválido también cuenta para el bloqueo por intentos,
          // para no dejar el segundo factor abierto a fuerza bruta.
          await this.handleFailedLogin(user.id, ip);
          throw err;
        }
      }
    }

    // Sesión con UN colegio activo: el token lleva SOLO los roles de ese colegio,
    // para que roles de otro colegio no se apliquen al colegio activo (cross-tenant).
    const schoolId = user.schoolRoles[0]?.schoolId ?? '';
    const userRoles = user.schoolRoles.filter((r) => r.schoolId === schoolId).map((r) => r.role);

    // Check if any active-school role requires 2FA but user hasn't set it up
    const requires2fa = userRoles.some((r) => ROLES_REQUIRING_2FA.includes(r));
    if (requires2fa && !totpEnabled) {
      const setupToken = await this.tokens.issueSetupToken(
        user.id,
        user.email,
        schoolId,
        userRoles,
      );
      return { setupToken, requiresTotp: false, requiresTotpSetup: true };
    }

    // Reset failed logins on success
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });

    // Rehash if needed (argon2 params changed)
    if (await this.passwords.needsRehash(user.passwordHash)) {
      const newHash = await this.passwords.hash(dto.password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    }

    const pair = await this.tokens.issueTokenPair(
      { sub: user.id, email: user.email, schoolId, roles: userRoles, totpVerified: totpEnabled },
      ip,
      ua,
    );

    await this.audit.log({ userId: user.id, action: 'LOGIN', ip, ua });

    let deviceToken: string | undefined;
    if (totpEnabled && !totpSkipped && dto.rememberDevice) {
      deviceToken = await this.totp.trustDevice(user.id, ua);
    }

    return {
      ...pair,
      requiresTotp: false as const,
      requiresTotpSetup: false as const,
      ...(deviceToken ? { deviceToken } : {}),
    };
  }

  async completeTotpSetup(
    userId: string,
    email: string,
    schoolId: string,
    roles: string[],
    ip?: string,
    ua?: string,
  ): Promise<TokenPair> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins: 0, lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });
    const pair = await this.tokens.issueTokenPair(
      { sub: userId, email, schoolId, roles, totpVerified: true },
      ip,
      ua,
    );
    await this.audit.log({ userId, action: 'TOTP_ENABLE', ip, ua });
    await this.audit.log({ userId, action: 'LOGIN', ip, ua });
    return pair;
  }

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email ya registrado');

    const pwned = await this.passwords.isPwned(dto.password);
    if (pwned) throw new BadRequestException('Contraseña comprometida — usa una diferente');

    const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId } });
    if (!school) throw new BadRequestException('Colegio no encontrado');

    const passwordHash = await this.passwords.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        schoolRoles: {
          create: dto.roles.map((role) => ({ schoolId: dto.schoolId, role })),
        },
      },
    });

    await this.audit.log({ userId: user.id, action: 'CREATE', entity: 'User', entityId: user.id });

    return { id: user.id, email: user.email };
  }

  async refresh(rawToken: string, ip?: string, ua?: string): Promise<TokenPair> {
    return this.tokens.rotateRefreshToken(rawToken, ip, ua);
  }

  async unlockUser(targetUserId: string, actor: JwtPayload): Promise<{ unlocked: true }> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { schoolRoles: { select: { schoolId: true, role: true } } },
    });
    if (!target) throw new BadRequestException('Usuario no encontrado');

    // SUPER_ADMIN desbloquea a cualquiera; el resto solo dentro de su colegio y
    // nunca a un SUPER_ADMIN (evita IDOR cross-tenant / escalada).
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN)) {
      const targetSchoolIds = target.schoolRoles.map((r) => r.schoolId);
      const sameSchool = targetSchoolIds.length === 0 || targetSchoolIds.includes(actor.schoolId);
      if (!sameSchool) {
        throw new ForbiddenException('No puedes administrar usuarios de otro colegio');
      }
      if (target.schoolRoles.some((r) => r.role === SystemRole.SUPER_ADMIN)) {
        throw new ForbiddenException('Solo SUPER_ADMIN puede administrar SUPER_ADMIN');
      }
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: 'ACTIVE', failedLogins: 0, lockedUntil: null },
    });
    await this.audit.log({
      userId: actor.sub,
      action: 'UPDATE',
      entity: 'User',
      entityId: targetUserId,
      meta: { unlocked: true },
    });
    return { unlocked: true };
  }

  async logout(userId: string, rawToken?: string): Promise<void> {
    if (rawToken) {
      await this.tokens.revokeToken(rawToken);
    } else {
      await this.tokens.revokeAllUserTokens(userId);
    }
    await this.audit.log({ userId, action: 'LOGOUT' });
  }

  private async handleFailedLogin(userId: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins: { increment: 1 }, lastLoginIp: ip ?? null },
      select: { failedLogins: true },
    });

    if (user.failedLogins >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'LOCKED',
          lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
        },
      });
    }
  }
}
