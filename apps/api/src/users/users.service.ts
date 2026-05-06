import * as crypto from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemRole, type UserStatus } from '@prisma/client';

import { PasswordService } from '../auth/services/password.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        schoolRoles: { select: { schoolId: true, role: true } },
        totpSecrets: { select: { verified: true } },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return { ...user, twoFactorEnabled: user.totpSecrets.some((t) => t.verified) };
  }

  async findBySchool(schoolId: string, roles?: SystemRole[]) {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        schoolRoles: {
          some: { schoolId, ...(roles?.length ? { role: { in: roles } } : {}) },
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        lastLoginAt: true,
        schoolRoles: { where: { schoolId }, select: { role: true } },
        totpSecrets: { select: { verified: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findByIdForActor(id: string, actor: JwtPayload) {
    const user = await this.findById(id);
    this.assertCanReadUser(
      actor,
      user.schoolRoles.map((role) => role.schoolId),
    );
    return user;
  }

  async findBySchoolForActor(schoolId: string, actor: JwtPayload, roles?: SystemRole[]) {
    this.assertCanAccessSchool(actor, schoolId);
    return this.findBySchool(schoolId, roles);
  }

  async softDelete(id: string, actor?: JwtPayload) {
    if (actor && actor.sub === id)
      throw new BadRequestException('No puedes eliminar tu propia cuenta');
    if (actor) await this.assertCanManageUser(actor, id);
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  async updateUser(
    id: string,
    dto: { firstName?: string; lastName?: string; phone?: string; status?: UserStatus },
    actor?: JwtPayload,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (actor) await this.assertCanManageUser(actor, id);
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.firstName ? { firstName: dto.firstName.trim() } : {}),
        ...(dto.lastName ? { lastName: dto.lastName.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, status: true },
    });
  }

  async updateRoles(userId: string, schoolId: string, roles: SystemRole[], actor?: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (actor) {
      this.assertCanAccessSchool(actor, schoolId);
      this.assertCanAssignRoles(actor, roles);
      await this.assertCanManageUser(actor, userId);
    }
    // Delete existing roles for this school, then recreate
    await this.prisma.userSchoolRole.deleteMany({ where: { userId, schoolId } });
    if (roles.length) {
      await this.prisma.userSchoolRole.createMany({
        data: roles.map((role) => ({ userId, schoolId, role })),
      });
    }
    return this.findById(userId);
  }

  async unlockUser(id: string, actor?: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (actor) await this.assertCanManageUser(actor, id);
    await this.prisma.user.update({
      where: { id },
      data: { failedLogins: 0, lockedUntil: null, status: 'ACTIVE' },
    });
    return { ok: true };
  }

  async createUser(
    dto: {
      email: string;
      firstName: string;
      lastName: string;
      schoolId: string;
      role: SystemRole;
      sendWelcomeEmail?: boolean;
    },
    actor?: JwtPayload,
  ) {
    if (actor) {
      this.assertCanAccessSchool(actor, dto.schoolId);
      this.assertCanAssignRoles(actor, [dto.role]);
    }
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (exists) {
      const hasRole = await this.prisma.userSchoolRole.findUnique({
        where: {
          userId_schoolId_role: { userId: exists.id, schoolId: dto.schoolId, role: dto.role },
        },
      });
      if (!hasRole) {
        await this.prisma.userSchoolRole.create({
          data: { userId: exists.id, schoolId: dto.schoolId, role: dto.role },
        });
      }
      return { id: exists.id, email: exists.email, isExisting: true, tempPassword: null };
    }

    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const passwordHash = await this.passwords.hash(tempPassword);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        passwordHash,
        status: 'ACTIVE',
        schoolRoles: { create: { schoolId: dto.schoolId, role: dto.role } },
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    if (dto.sendWelcomeEmail) {
      const school = await this.prisma.school.findUnique({
        where: { id: dto.schoolId },
        select: { name: true },
      });
      void this.mail
        .enqueue({
          to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
          subject: `Bienvenido — ${school?.name ?? 'Colegio'}`,
          html: `<p>Hola ${user.firstName},</p><p>Tu cuenta ha sido creada con el rol <strong>${dto.role}</strong>.</p><p>Tu contraseña temporal es: <strong>${tempPassword}</strong></p><p>Inicia sesión y cámbiala.</p>`,
          text: `Hola ${user.firstName},\nTu contraseña temporal es: ${tempPassword}`,
          category: 'SYSTEM',
          priority: 'HIGH',
        })
        .catch(() => undefined);
    }

    return { ...user, isExisting: false, tempPassword };
  }

  async createApoderado(dto: {
    email: string;
    firstName: string;
    lastName: string;
    schoolId: string;
    sendWelcomeEmail?: boolean;
  }) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (exists) {
      // User already exists — just ensure schoolRole APODERADO
      const hasRole = await this.prisma.userSchoolRole.findUnique({
        where: {
          userId_schoolId_role: { userId: exists.id, schoolId: dto.schoolId, role: 'APODERADO' },
        },
      });
      if (!hasRole) {
        await this.prisma.userSchoolRole.create({
          data: { userId: exists.id, schoolId: dto.schoolId, role: 'APODERADO' },
        });
      }
      return { id: exists.id, email: exists.email, isExisting: true, tempPassword: null };
    }

    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const passwordHash = await this.passwords.hash(tempPassword);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        passwordHash,
        status: 'ACTIVE',
        schoolRoles: { create: { schoolId: dto.schoolId, role: 'APODERADO' } },
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    if (dto.sendWelcomeEmail) {
      const school = await this.prisma.school.findUnique({
        where: { id: dto.schoolId },
        select: { name: true },
      });
      void this.mail
        .enqueue({
          to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
          subject: `Bienvenido al Portal de Apoderados — ${school?.name ?? 'Colegio'}`,
          html: `<p>Hola ${user.firstName},</p><p>Tu cuenta ha sido creada. Tu contraseña temporal es: <strong>${tempPassword}</strong></p><p>Por favor cámbiala al ingresar.</p>`,
          text: `Hola ${user.firstName},\nTu contraseña temporal es: ${tempPassword}\nPor favor cámbiala al ingresar.`,
          category: 'SYSTEM',
          priority: 'HIGH',
        })
        .catch(() => undefined);
    }

    return { ...user, isExisting: false, tempPassword };
  }

  async resetPassword(userId: string, actor?: JwtPayload): Promise<{ tempPassword: string }> {
    if (actor) await this.assertCanManageUser(actor, userId);
    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const passwordHash = await this.passwords.hash(tempPassword);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { email: true, firstName: true, lastName: true },
    });
    void this.mail
      .enqueue({
        to: { email: user.email, name: `${user.firstName} ${user.lastName}` },
        subject: 'Tu contraseña ha sido restablecida',
        html: `<p>Hola ${user.firstName},</p><p>Tu contraseña ha sido restablecida por un administrador. Tu nueva contraseña temporal es: <strong>${tempPassword}</strong></p><p>Inicia sesión y cámbiala de inmediato.</p>`,
        text: `Hola ${user.firstName},\nTu contraseña ha sido restablecida. Contraseña temporal: ${tempPassword}\nCámbiala de inmediato.`,
        category: 'SYSTEM',
        priority: 'HIGH',
      })
      .catch(() => undefined);
    return { tempPassword };
  }

  async findTrashed(schoolId: string, actor: JwtPayload) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN))
      throw new ForbiddenException('Solo SUPER_ADMIN');
    return this.prisma.user.findMany({
      where: {
        deletedAt: { not: null },
        schoolRoles: { some: { schoolId } },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        deletedAt: true,
        schoolRoles: { where: { schoolId }, select: { role: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async restore(id: string, actor: JwtPayload) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN))
      throw new ForbiddenException('Solo SUPER_ADMIN');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.deletedAt) throw new BadRequestException('El usuario no está eliminado');
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  }

  async purge(id: string, actor: JwtPayload) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN))
      throw new ForbiddenException('Solo SUPER_ADMIN');
    if (actor.sub === id) throw new BadRequestException('No puedes purgar tu propia cuenta');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.prisma.user.update({
      where: { id },
      data: {
        email: `deleted-${id}@purged.local`,
        firstName: '[Eliminado]',
        lastName: '[Eliminado]',
        phone: null,
        passwordHash: crypto.randomBytes(32).toString('hex'),
        deletedAt: new Date(),
        status: 'INACTIVE',
      },
      select: { id: true },
    });
  }

  private assertCanAccessSchool(actor: JwtPayload, schoolId: string) {
    if (actor.roles.includes('SUPER_ADMIN')) return;
    if (actor.schoolId === schoolId) return;
    throw new ForbiddenException('Sin acceso a este colegio');
  }

  private assertCanAssignRoles(actor: JwtPayload, roles: SystemRole[]) {
    if (actor.roles.includes(SystemRole.SUPER_ADMIN)) return;
    if (roles.includes(SystemRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede asignar SUPER_ADMIN');
    }
  }

  private assertCanReadUser(actor: JwtPayload, targetSchoolIds: string[]) {
    if (actor.roles.includes(SystemRole.SUPER_ADMIN)) return;
    if (targetSchoolIds.includes(actor.schoolId)) return;
    throw new ForbiddenException('Sin acceso a este usuario');
  }

  private async assertCanManageUser(actor: JwtPayload, targetUserId: string) {
    if (actor.roles.includes(SystemRole.SUPER_ADMIN)) return;
    const roles = await this.prisma.userSchoolRole.findMany({
      where: { userId: targetUserId },
      select: { schoolId: true, role: true },
    });
    this.assertCanReadUser(
      actor,
      roles.map((role) => role.schoolId),
    );
    if (roles.some((role) => role.role === SystemRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede administrar SUPER_ADMIN');
    }
  }
}
