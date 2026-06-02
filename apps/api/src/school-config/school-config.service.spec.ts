import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SchoolConfigService } from './school-config.service.js';

function makeService(opts?: {
  saved?: object | null;
  attendanceDates?: Date[];
  upsertResult?: object;
}) {
  const prisma = {
    school: {
      findUnique: vi.fn().mockResolvedValue({ id: 'school-1' }),
    },
    schoolAcademicYearConfig: {
      findUnique: vi.fn().mockResolvedValue(opts?.saved ?? null),
      upsert: vi.fn().mockResolvedValue(
        opts?.upsertResult ?? {
          id: 'config-1',
          schoolId: 'school-1',
          year: 2026,
          firstSemesterStart: new Date(2026, 2, 4),
          firstSemesterEnd: new Date(2026, 5, 18, 23, 59, 59, 999),
          secondSemesterStart: new Date(2026, 6, 1),
          secondSemesterEnd: new Date(2026, 11, 31, 23, 59, 59, 999),
        },
      ),
    },
    attendanceRecord: {
      findMany: vi.fn().mockResolvedValue((opts?.attendanceDates ?? []).map((date) => ({ date }))),
    },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new SchoolConfigService(prisma as never, audit as never),
    prisma,
    audit,
  };
}

describe('SchoolConfigService', () => {
  it('devuelve defaults escolares cuando no existe configuración guardada', async () => {
    const { service } = makeService();

    await expect(service.getAcademicYearConfig('school-1', 2026)).resolves.toMatchObject({
      source: 'default',
      firstSemester: { startDate: '2026-03-04', endDate: '2026-06-18' },
      secondSemester: { startDate: '2026-07-01', endDate: '2026-12-31' },
    });
  });

  it('rechaza fechas desordenadas', async () => {
    const { service } = makeService();

    await expect(
      service.upsertAcademicYearConfig(
        'school-1',
        2026,
        {
          firstSemesterStart: '2026-06-19',
          firstSemesterEnd: '2026-06-18',
          secondSemesterStart: '2026-07-01',
          secondSemesterEnd: '2026-12-31',
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bloquea configuraciones que dejan asistencias fuera de los semestres', async () => {
    const { service, prisma } = makeService({ attendanceDates: [new Date(2026, 5, 20)] });

    await expect(
      service.upsertAcademicYearConfig(
        'school-1',
        2026,
        {
          firstSemesterStart: '2026-03-04',
          firstSemesterEnd: '2026-06-18',
          secondSemesterStart: '2026-07-01',
          secondSemesterEnd: '2026-12-31',
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.schoolAcademicYearConfig.upsert).not.toHaveBeenCalled();
  });

  it('guarda y audita una configuración válida', async () => {
    const { service, prisma, audit } = makeService();

    await service.upsertAcademicYearConfig(
      'school-1',
      2026,
      {
        firstSemesterStart: '2026-03-04',
        firstSemesterEnd: '2026-06-18',
        secondSemesterStart: '2026-07-01',
        secondSemesterEnd: '2026-12-31',
      },
      'user-1',
    );

    expect(prisma.schoolAcademicYearConfig.upsert).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'SchoolAcademicYearConfig',
      }),
    );
  });
});
