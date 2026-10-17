import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown) {
  const send = vi.fn();
  const reply = { status: vi.fn().mockReturnValue({ send }) };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ url: '/x', method: 'POST' }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: reply.status.mock.calls[0]?.[0], body: send.mock.calls[0]?.[0] };
}

describe('AllExceptionsFilter', () => {
  it('entrega el mensaje como texto plano, no anidado', () => {
    const { status, body } = run(new UnauthorizedException('Código 2FA inválido'));
    expect(status).toBe(401);
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe('Código 2FA inválido');
  });

  it('deja los campos extra al nivel superior (intentos restantes, conflictos)', () => {
    const { body } = run(
      new UnauthorizedException({ message: 'Credenciales inválidas', remainingAttempts: 2 }),
    );
    expect(body.message).toBe('Credenciales inválidas');
    expect(body.remainingAttempts).toBe(2);

    const conflict = run(
      new ConflictException({ message: 'Conflicto', conflictingDates: ['2026-03-04'] }),
    ).body;
    expect(conflict.statusCode).toBe(409);
    expect(conflict.conflictingDates).toEqual(['2026-03-04']);
  });

  it('responde 500 con mensaje genérico ante errores no controlados', () => {
    const { status, body } = run(new Error('detalle interno'));
    expect(status).toBe(500);
    expect(body.message).toBe('Error interno del servidor');
  });
});
