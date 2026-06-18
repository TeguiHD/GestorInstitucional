import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TotpService } from './totp.service.js';

describe('TotpService anti-replay', () => {
  const prevKey = process.env['TOTP_ENC_KEY'];
  beforeAll(() => {
    process.env['TOTP_ENC_KEY'] = '11'.repeat(32); // 32-byte hex
  });
  afterAll(() => {
    if (prevKey === undefined) delete process.env['TOTP_ENC_KEY'];
    else process.env['TOTP_ENC_KEY'] = prevKey;
  });

  function makeService() {
    let record: {
      userId: string;
      secret: string;
      verified: boolean;
      lastTotpStep: number | null;
    } = { userId: 'u1', secret: '', verified: true, lastTotpStep: null };

    const prisma = {
      totpSecret: {
        findUnique: vi.fn(async () => record),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          record = { ...record, ...data };
          return record;
        }),
      },
    };
    const config = { get: (key: string) => (key === 'totp.window' ? 1 : 'Asistencia') };
    const service = new TotpService(prisma as never, config as never, {} as never);
    // Genera un secreto y lo cifra con el mismo formato que usa el servicio.
    const secret = authenticator.generateSecret(32);
    record.secret = (service as unknown as { encryptSecret: (s: string) => string }).encryptSecret(
      secret,
    );
    return { service, secret, prisma };
  }

  it('acepta un código válido una vez y rechaza su reuso (replay)', async () => {
    const { service, secret } = makeService();
    const token = authenticator.generate(secret);

    expect(await service.verify('u1', token)).toBe(true);
    // Mismo código (mismo timestep) ya consumido -> rechazado.
    expect(await service.verify('u1', token)).toBe(false);
  });

  it('rechaza un código inválido sin marcar timestep', async () => {
    const { service, prisma } = makeService();
    expect(await service.verify('u1', '000000')).toBe(false);
    // no debe persistir lastTotpStep en un intento inválido
    const updateCalls = prisma.totpSecret.update.mock.calls.length;
    expect(updateCalls).toBe(0);
  });
});
