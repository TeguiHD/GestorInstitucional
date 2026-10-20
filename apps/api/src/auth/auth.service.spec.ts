import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';

type UserOverrides = Partial<{
  role: string;
  mfaExemptAt: Date | null;
  mfaExemptUntil: Date | null;
}>;

function makeAuth(opts: { totpEnabled: boolean; user?: UserOverrides }) {
  const user = {
    id: 'u1',
    email: 'jenny@colegio.cl',
    passwordHash: 'hash',
    status: 'ACTIVE',
    failedLogins: 0,
    lockedUntil: null,
    deletedAt: null,
    mfaExemptAt: opts.user?.mfaExemptAt ?? null,
    mfaExemptUntil: opts.user?.mfaExemptUntil ?? null,
    schoolRoles: [{ schoolId: 's1', role: opts.user?.role ?? 'INSPECTORIA' }],
  };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn() },
  };
  const passwords = { verify: vi.fn().mockResolvedValue(true), needsRehash: vi.fn() };
  const tokens = {
    issueTokenPair: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    issueSetupToken: vi.fn().mockResolvedValue('setup'),
  };
  const totp = {
    isEnabled: vi.fn().mockResolvedValue(opts.totpEnabled),
    isDeviceTrusted: vi.fn().mockResolvedValue(false),
    validateForLogin: vi.fn().mockResolvedValue(undefined),
    trustDevice: vi.fn(),
  };
  const audit = { log: vi.fn() };
  const service = new AuthService(
    prisma as never,
    passwords as never,
    tokens as never,
    totp as never,
    audit as never,
  );
  return { service, tokens, totp };
}

const DTO = { email: 'jenny@colegio.cl', password: 'x' };

describe('AuthService.login — exención de 2FA', () => {
  it('sin exención, un usuario con 2FA activo debe ingresar el código', async () => {
    const { service } = makeAuth({ totpEnabled: true });
    await expect(service.login(DTO as never)).resolves.toMatchObject({ requiresTotp: true });
  });

  it('con exención vigente entra sin código aunque tenga 2FA configurado', async () => {
    const { service, totp, tokens } = makeAuth({
      totpEnabled: true,
      user: { mfaExemptAt: new Date('2026-01-01T00:00:00Z'), mfaExemptUntil: null },
    });

    await expect(service.login(DTO as never)).resolves.toMatchObject({
      accessToken: 'a',
      requiresTotp: false,
    });
    expect(totp.validateForLogin).not.toHaveBeenCalled();
    expect(tokens.issueTokenPair).toHaveBeenCalledWith(
      expect.objectContaining({ totpVerified: true }),
      undefined,
      undefined,
    );
  });

  it('un SUPER_ADMIN exento no es obligado a configurar el autenticador', async () => {
    const { service, tokens } = makeAuth({
      totpEnabled: false,
      user: { role: 'SUPER_ADMIN', mfaExemptAt: new Date('2026-01-01T00:00:00Z') },
    });

    await expect(service.login(DTO as never)).resolves.toMatchObject({
      requiresTotpSetup: false,
    });
    expect(tokens.issueSetupToken).not.toHaveBeenCalled();
  });

  it('una exención vencida vuelve a pedir el código', async () => {
    const { service } = makeAuth({
      totpEnabled: true,
      user: {
        mfaExemptAt: new Date('2026-01-01T00:00:00Z'),
        mfaExemptUntil: new Date('2026-01-02T00:00:00Z'),
      },
    });
    await expect(service.login(DTO as never)).resolves.toMatchObject({ requiresTotp: true });
  });
});
