import * as crypto from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SystemRole, UserStatus } from '@prisma/client';

import { PasswordService } from '../auth/services/password.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

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

  async softDelete(id: string, actorId?: string) {
    if (actorId && actorId === id)
      throw new BadRequestException('No puedes eliminar tu propia cuenta');
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }

  async updateUser(
    id: string,
    dto: { firstName?: string; lastName?: string; phone?: string; status?: UserStatus },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
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

  async updateRoles(userId: string, schoolId: string, roles: SystemRole[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    // Delete existing roles for this school, then recreate
    await this.prisma.userSchoolRole.deleteMany({ where: { userId, schoolId } });
    if (roles.length) {
      await this.prisma.userSchoolRole.createMany({
        data: roles.map((role) => ({ userId, schoolId, role })),
      });
    }
    return this.findById(userId);
  }

  async unlockUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.prisma.user.update({
      where: { id },
      data: { failedLogins: 0, lockedUntil: null, status: 'ACTIVE' },
    });
    return { ok: true };
  }

  async createUser(dto: {
    email: string;
    firstName: string;
    lastName: string;
    schoolId: string;
    role: SystemRole;
    sendWelcomeEmail?: boolean;
  }) {
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

    const tempPassword = crypto.randomBytes(6).toString('base64url');
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

    const tempPassword = crypto.randomBytes(6).toString('base64url'); // 8-char URL-safe
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

  async resetPassword(userId: string): Promise<{ tempPassword: string }> {
    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = await this.passwords.hash(tempPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { tempPassword };
  }
}
