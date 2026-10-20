import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { UserMfaAdminService } from './user-mfa-admin.service.js';

const ADMIN = { sub: 'admin-1', schoolId: 's1', roles: ['SUPER_ADMIN'] } as never;
const DIRECTOR = { sub: 'dir-1', schoolId: 's1', roles: ['DIRECTOR'] } as never;

function makeService(target: { roles?: string[]; totp?: boolean; deleted?: boolean } | null) {
  const user = target && {
    id: 'jenny',
    email: 'jennys@colegio.cl',
    firstName: 'Jenny',
    lastName: 'Salazar',
    deletedAt: target.deleted ? new Date() : null,
    mfaExemptAt: null as Date | null,
    mfaExemptUntil: null as Date | null,
    schoolRoles: (target.roles ?? ['INSPECTORIA']).map((role) => ({ role })),
    totpSecrets: target.totp ? [{ verified: true }] : [],
  };
  const tx = {
    totpSecret: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    trustedDevice: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        Object.assign(user!, data),
      ),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const mail = { enqueue: vi.fn().mockResolvedValue({ id: 'm1' }) };
  return {
    service: new UserMfaAdminService(prisma as never, audit as never, mail as never),
    prisma,
    tx,
    audit,
    mail,
  };
}

describe('UserMfaAdminService', () => {
  it('restablece: borra el autenticador y los dispositivos de confianza, audita y avisa', async () => {
    const { service, tx, audit, mail } = makeService({ totp: true });

    await expect(service.reset(ADMIN, 'jenny')).resolves.toMatchObject({ enabled: false });
    expect(tx.totpSecret.deleteMany).toHaveBeenCalledWith({ where: { userId: 'jenny' } });
    expect(tx.trustedDevice.deleteMany).toHaveBeenCalledWith({ where: { userId: 'jenny' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'TOTP_DISABLE',
        entity: 'User',
        entityId: 'jenny',
        meta: expect.objectContaining({ mode: 'admin_reset' }),
      }),
    );
    expect(mail.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: expect.objectContaining({ email: 'jennys@colegio.cl' }) }),
    );
  });

  it('desactiva en forma indefinida o hasta una fecha, sin borrar el autenticador', async () => {
    const { service, tx, prisma } = makeService({ totp: true });

    await expect(service.setExemption(ADMIN, 'jenny', { until: null })).resolves.toMatchObject({
      enabled: true,
      exempt: true,
      exemptUntil: null,
    });
    expect(tx.totpSecret.deleteMany).not.toHaveBeenCalled();

    const until = new Date(Date.now() + 7 * 86_400_000);
    await service.setExemption(ADMIN, 'jenny', { until, reason: 'Cambió de teléfono' });
    expect(prisma.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mfaExemptUntil: until,
          mfaExemptById: 'admin-1',
          mfaExemptReason: 'Cambió de teléfono',
        }),
      }),
    );
  });

  it('reactiva: quita la exención y lo audita', async () => {
    const { service, audit } = makeService({ totp: true });
    await service.setExemption(ADMIN, 'jenny', { until: null });

    await expect(service.clearExemption(ADMIN, 'jenny')).resolves.toMatchObject({
      exempt: false,
    });
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'TOTP_ENABLE',
        meta: expect.objectContaining({ mode: 'admin_exemption_revoked' }),
      }),
    );
  });

  it('rechaza una fecha de término pasada', async () => {
    const { service } = makeService({});
    await expect(
      service.setExemption(ADMIN, 'jenny', { until: new Date(Date.now() - 1000) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo SUPER_ADMIN, nunca sobre sí mismo, y a otro SUPER_ADMIN solo se le restablece', async () => {
    await expect(makeService({}).service.reset(DIRECTOR, 'jenny')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(makeService({}).service.reset(ADMIN, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const otherAdmin = makeService({ roles: ['SUPER_ADMIN'] });
    await expect(
      otherAdmin.service.setExemption(ADMIN, 'jenny', { until: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(otherAdmin.service.reset(ADMIN, 'jenny')).resolves.toBeDefined();
  });

  it('usuario inexistente o eliminado', async () => {
    await expect(makeService(null).service.reset(ADMIN, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      makeService({ deleted: true }).service.reset(ADMIN, 'jenny'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
