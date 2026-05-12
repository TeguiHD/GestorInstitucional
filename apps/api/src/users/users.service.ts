import * as crypto from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemRole, type UserStatus } from '@prisma/client';

import { PasswordService } from '../auth/services/password.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
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
        phone: true,
        avatarPath: true,
        avatarUpdatedAt: true,
        schoolRoles: { select: { schoolId: true, role: true } },
        totpSecrets: { select: { verified: true } },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const { avatarPath: _avatarPath, ...profile } = user;
    return {
      ...profile,
      twoFactorEnabled: user.totpSecrets.some((t) => t.verified),
      hasAvatar: Boolean(user.avatarPath),
    };
  }

  async findBySchool(schoolId: string, roles?: SystemRole[]) {
    const users = await this.prisma.user.findMany({
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
        avatarPath: true,
        avatarUpdatedAt: true,
        schoolRoles: { where: { schoolId }, select: { role: true } },
        totpSecrets: { select: { verified: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users.map(({ avatarPath, ...user }) => ({
      ...user,
      hasAvatar: Boolean(avatarPath),
    }));
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
    // BUG-04: invalidate all active sessions before disabling account
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
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
      // BUG-05: use upsert to avoid race condition on concurrent create requests
      await this.prisma.userSchoolRole.upsert({
        where: {
          userId_schoolId_role: { userId: exists.id, schoolId: dto.schoolId, role: dto.role },
        },
        update: {},
        create: { userId: exists.id, schoolId: dto.schoolId, role: dto.role },
      });
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
    // BUG-02: verify user exists and is not soft-deleted before updating
    const target = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const passwordHash = await this.passwords.hash(tempPassword);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
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

  /**
   * SUPER_ADMIN sets a specific password for a non-SUPER_ADMIN user.
   */
  async setPasswordByAdmin(
    targetUserId: string,
    newPassword: string,
    actor: JwtPayload,
  ): Promise<{ ok: true }> {
    // Only SUPER_ADMIN can use this
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede establecer contraseñas');
    }

    // Cannot change own password via this method
    if (actor.sub === targetUserId) {
      throw new BadRequestException('Usa el cambio de contraseña propio');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId, deletedAt: null },
      include: { schoolRoles: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Cannot change password of another SUPER_ADMIN
    if (user.schoolRoles.some((r) => r.role === SystemRole.SUPER_ADMIN)) {
      throw new ForbiddenException('No se puede modificar la contraseña de otro SUPER_ADMIN');
    }

    // Validate minimum length
    if (newPassword.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }

    // Pwned check
    const pwned = await this.passwords.isPwned(newPassword);
    if (pwned) {
      throw new BadRequestException('La contraseña aparece en filtraciones conocidas');
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    });

    await this.audit.log({
      userId: actor.sub,
      action: 'PASSWORD_CHANGE',
      entity: 'User',
      entityId: targetUserId,
      meta: { adminSetPassword: true },
    });

    return { ok: true };
  }

  async changeOwnPassword(
    userId: string,
    dto: { currentPassword: string; newPassword: string },
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const validCurrent = await this.passwords.verify(user.passwordHash, dto.currentPassword);
    if (!validCurrent) throw new BadRequestException('Contraseña actual incorrecta');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La contraseña nueva debe ser distinta a la actual');
    }

    const pwned = await this.passwords.isPwned(dto.newPassword);
    if (pwned) {
      throw new BadRequestException('La contraseña aparece en filtraciones conocidas');
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    });
    await this.audit.log({
      userId,
      action: 'PASSWORD_CHANGE',
      entity: 'User',
      entityId: userId,
    });
    return { ok: true };
  }

  async updateOwnProfile(
    userId: string,
    dto: { firstName?: string; lastName?: string; phone?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName ? { firstName: dto.firstName.trim() } : {}),
        ...(dto.lastName ? { lastName: dto.lastName.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
      },
    });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'User',
      entityId: userId,
      meta: { ownProfile: true },
    });
    return this.findById(userId);
  }

  async setOwnAvatar(params: {
    userId: string;
    filename: string;
    mimetype: string;
    stream: NodeJS.ReadableStream;
  }): Promise<{ ok: true; avatarUpdatedAt: Date }> {
    if (!AVATAR_MIME.has(params.mimetype)) {
      throw new BadRequestException('Formato no permitido. Usa JPG, PNG o WEBP.');
    }

    const current = await this.prisma.user.findUnique({
      where: { id: params.userId, deletedAt: null },
      select: { avatarPath: true },
    });
    if (!current) throw new NotFoundException('Usuario no encontrado');

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of params.stream as AsyncIterable<Buffer | Uint8Array>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_AVATAR_BYTES) {
        throw new BadRequestException('La imagen supera 2 MB.');
      }
      chunks.push(buf);
    }

    const dir = join(UPLOADS_ROOT, 'avatars');
    await mkdir(dir, { recursive: true });
    const rawExt = extname(params.filename).toLowerCase();
    const ext =
      rawExt && ['.jpg', '.jpeg', '.png', '.webp'].includes(rawExt)
        ? rawExt
        : params.mimetype === 'image/png'
          ? '.png'
          : params.mimetype === 'image/webp'
            ? '.webp'
            : '.jpg';
    const filePath = join(dir, `${params.userId}-${crypto.randomUUID()}${ext}`);
    await writeFile(filePath, Buffer.concat(chunks));

    const avatarUpdatedAt = new Date();
    await this.prisma.user.update({
      where: { id: params.userId },
      data: { avatarPath: filePath, avatarMime: params.mimetype, avatarUpdatedAt },
    });
    if (current.avatarPath) {
      await unlink(current.avatarPath).catch(() => undefined);
    }
    await this.audit.log({
      userId: params.userId,
      action: 'UPDATE',
      entity: 'User',
      entityId: params.userId,
      meta: { avatar: true, size },
    });
    return { ok: true, avatarUpdatedAt };
  }

  async getOwnAvatar(userId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { avatarPath: true, avatarMime: true },
    });
    if (!user?.avatarPath || !user.avatarMime) throw new NotFoundException('Avatar no configurado');
    const safePath = resolve(user.avatarPath);
    const allowedRoot = resolve(UPLOADS_ROOT, 'avatars');
    if (!safePath.startsWith(allowedRoot + '/') && safePath !== allowedRoot) {
      throw new ForbiddenException('Ruta de avatar inválida');
    }
    return { buffer: await readFile(safePath), mimeType: user.avatarMime };
  }

  async removeOwnAvatar(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { avatarPath: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarPath: null, avatarMime: null, avatarUpdatedAt: null },
    });
    if (user.avatarPath) await unlink(user.avatarPath).catch(() => undefined);
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'User',
      entityId: userId,
      meta: { avatarRemoved: true },
    });
    return { ok: true };
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
    // BUG-03: invalidate all active sessions before purging
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
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
    // BUG-06: if target has no school roles yet, allow if actor is from same school
    const schoolIds = roles.length > 0 ? roles.map((r) => r.schoolId) : [actor.schoolId]; // fallback: allow same-school actor to manage roleless users
    this.assertCanReadUser(actor, schoolIds);
    if (roles.some((role) => role.role === SystemRole.SUPER_ADMIN)) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede administrar SUPER_ADMIN');
    }
  }
}
