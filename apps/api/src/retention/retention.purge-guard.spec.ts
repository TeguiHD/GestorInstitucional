import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RetentionService } from './retention.service.js';

import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

/**
 * La purga de retención borra asistencia, justificaciones y auditoría de forma
 * irreversible. Son datos de menores con valor legal ante MINEDUC. Estas pruebas
 * cubren las barreras que impiden ejecutarla por accidente.
 */

const superAdmin = { sub: 'u-1', roles: [SystemRole.SUPER_ADMIN] } as JwtPayload;
const director = { sub: 'u-2', roles: [SystemRole.DIRECTOR] } as JwtPayload;

const CONFIRMACION = 'PURGAR DEFINITIVAMENTE';

/** Conteos que devolvería el preview. */
function conteos(over: Partial<Record<string, number>> = {}) {
  return {
    attendance: 10,
    justifications: 2,
    audit: 5,
    mail: 1,
    alerts: 0,
    tokens: 3,
    ...over,
  };
}

function makeService(previewCounts = conteos()) {
  const prisma = {
    attendanceRecord: {
      count: vi.fn().mockResolvedValue(previewCounts.attendance),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: previewCounts.attendance }),
    },
    attendanceJustification: {
      count: vi.fn().mockResolvedValue(previewCounts.justifications),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: previewCounts.justifications }),
    },
    auditEvent: {
      count: vi.fn().mockResolvedValue(previewCounts.audit),
      deleteMany: vi.fn().mockResolvedValue({ count: previewCounts.audit }),
    },
    mailOutbox: {
      count: vi.fn().mockResolvedValue(previewCounts.mail),
      deleteMany: vi.fn().mockResolvedValue({ count: previewCounts.mail }),
    },
    alertFired: {
      count: vi.fn().mockResolvedValue(previewCounts.alerts),
      deleteMany: vi.fn().mockResolvedValue({ count: previewCounts.alerts }),
    },
    refreshToken: {
      count: vi.fn().mockResolvedValue(previewCounts.tokens),
      deleteMany: vi.fn().mockResolvedValue({ count: previewCounts.tokens }),
    },
    retentionSnapshot: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    $transaction: vi
      .fn()
      .mockResolvedValue([
        { count: previewCounts.attendance },
        { count: previewCounts.justifications },
        { count: previewCounts.audit },
        { count: previewCounts.mail },
        { count: previewCounts.alerts },
        { count: previewCounts.tokens },
      ]),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new RetentionService(prisma as never, audit as never),
    prisma,
    audit,
  };
}

/** Petición válida en todos sus campos. */
function peticionValida(counts = conteos()) {
  return { confirm: CONFIRMACION, expected: counts };
}

describe('RetentionService.purge — barreras contra el borrado accidental', () => {
  const envOriginal = process.env.RETENTION_PURGE_ENABLED;

  beforeEach(() => {
    process.env.RETENTION_PURGE_ENABLED = 'true';
  });

  afterEach(() => {
    if (envOriginal === undefined) delete process.env.RETENTION_PURGE_ENABLED;
    else process.env.RETENTION_PURGE_ENABLED = envOriginal;
  });

  it('está apagada salvo que se active explícitamente por configuración', async () => {
    delete process.env.RETENTION_PURGE_ENABLED;
    const { service, prisma } = makeService();

    await expect(service.purge(superAdmin, peticionValida())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no basta con que la variable exista: debe valer exactamente "true"', async () => {
    process.env.RETENTION_PURGE_ENABLED = '1';
    const { service, prisma } = makeService();

    await expect(service.purge(superAdmin, peticionValida())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('exige la frase de confirmación exacta', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.purge(superAdmin, { confirm: 'purgar definitivamente', expected: conteos() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza si lo que hay ahora no coincide con lo que el operador vio', async () => {
    // El preview dijo 10 registros de asistencia; el operador manda 3.
    const { service, prisma } = makeService(conteos({ attendance: 10 }));

    await expect(
      service.purge(superAdmin, peticionValida(conteos({ attendance: 3 }))),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza si superaría el tope de seguridad', async () => {
    const { service, prisma } = makeService(conteos({ attendance: 999_999 }));

    await expect(
      service.purge(superAdmin, peticionValida(conteos({ attendance: 999_999 }))),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sigue rechazando a quien no es SUPER_ADMIN', async () => {
    const { service, prisma } = makeService();

    await expect(service.purge(director, peticionValida())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no borra nada cuando no hay nada que borrar', async () => {
    const vacio = conteos({
      attendance: 0,
      justifications: 0,
      audit: 0,
      mail: 0,
      alerts: 0,
      tokens: 0,
    });
    const { service, prisma } = makeService(vacio);

    const res = await service.purge(superAdmin, peticionValida(vacio));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res).toMatchObject({ nothingToPurge: true });
  });

  it('ejecuta cuando todas las barreras se cumplen', async () => {
    const { service, prisma, audit } = makeService();

    await service.purge(superAdmin, peticionValida());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalled();
  });
});
