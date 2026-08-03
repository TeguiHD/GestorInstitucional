import { BadRequestException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { formatDateOnlyKey } from '../common/date-only.js';
import { AttendanceService } from './attendance.service.js';

/**
 * El panel de asistencia permite corregir varios días antes de guardar. Hasta
 * ahora enviaba un POST por fecha: si una fallaba a mitad, unos días quedaban
 * guardados y otros no, sin forma de saber cuáles desde la interfaz.
 */

function dia(date: string, studentIds: string[]) {
  return {
    date,
    entries: studentIds.map((studentId) => ({
      studentId,
      status: AttendanceStatus.PRESENT,
    })),
  };
}

function makeService(params: {
  activeStudentIds: string[];
  /** Días que el calendario considera NO lectivos (feriados, vacaciones). */
  nonSchoolDays?: string[];
}) {
  const prisma = {
    student: {
      findMany: vi.fn().mockResolvedValue(params.activeStudentIds.map((id) => ({ id }))),
    },
    attendanceRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn((args) => args),
      create: vi.fn((args) => args),
    },
    course: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'course-1',
        code: '1A',
        name: 'Primero A',
        schoolId: 'school-1',
        students: params.activeStudentIds.map((id, idx) => ({
          id,
          firstName: `Alumno${idx + 1}`,
          lastName: 'Test',
          secondLastName: null,
          enrollmentNumber: idx + 1,
        })),
      }),
      findMany: vi.fn().mockResolvedValue([{ id: 'course-1', code: '1A', name: 'Primero A' }]),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const calendar = {
    getNonSchoolDays: vi.fn().mockResolvedValue(new Set(params.nonSchoolDays ?? [])),
  };
  const mail = { sendAbsenceDaily: vi.fn() };
  const whatsapp = { sendAbsenceAlert: vi.fn() };
  const schoolConfig = { formatDate: vi.fn((date: Date) => formatDateOnlyKey(date)) };

  return {
    service: new AttendanceService(
      prisma as never,
      audit as never,
      calendar as never,
      mail as never,
      whatsapp as never,
      schoolConfig as never,
    ),
    prisma,
    audit,
  };
}

describe('AttendanceService.recordBatch — varios días, una transacción', () => {
  it('guarda todos los días en una sola transacción', async () => {
    const { service, prisma } = makeService({ activeStudentIds: ['s1', 's2'] });

    const res = await service.recordBatch(
      {
        courseId: 'course-1',
        days: [
          dia('2026-05-12', ['s1', 's2']),
          dia('2026-05-13', ['s1', 's2']),
          dia('2026-05-14', ['s1', 's2']),
        ],
      },
      'user-1',
    );

    // La razón de existir: un commit, no uno por día.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(res.days).toBe(3);
    expect(res.upserted).toBe(6);
  });

  it('si un día es inválido no se guarda NINGUNO', async () => {
    // 13-mayo cae en día no lectivo: la validación debe frenar todo el lote.
    const { service, prisma } = makeService({
      activeStudentIds: ['s1', 's2'],
      nonSchoolDays: ['2026-05-13'],
    });

    await expect(
      service.recordBatch(
        {
          courseId: 'course-1',
          days: [dia('2026-05-12', ['s1', 's2']), dia('2026-05-13', ['s1', 's2'])],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Lo que antes fallaba: el día 12 quedaba guardado y el 13 no.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('si un día viene incompleto tampoco se guarda ninguno', async () => {
    const { service, prisma } = makeService({ activeStudentIds: ['s1', 's2'] });

    await expect(
      service.recordBatch(
        {
          courseId: 'course-1',
          days: [dia('2026-05-12', ['s1', 's2']), dia('2026-05-13', ['s1'])], // falta s2
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza fechas repetidas en el mismo lote', async () => {
    const { service, prisma } = makeService({ activeStudentIds: ['s1'] });

    await expect(
      service.recordBatch(
        {
          courseId: 'course-1',
          days: [dia('2026-05-12', ['s1']), dia('2026-05-12', ['s1'])],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deja un registro de auditoría por cada día guardado', async () => {
    const { service, audit } = makeService({ activeStudentIds: ['s1'] });

    await service.recordBatch(
      {
        courseId: 'course-1',
        days: [dia('2026-05-12', ['s1']), dia('2026-05-13', ['s1'])],
      },
      'user-1',
    );

    // La trazabilidad es por día: un solo evento agregado perdería qué cambió cada fecha.
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('un solo día por el camino nuevo se comporta igual que el endpoint de siempre', async () => {
    const { service, prisma } = makeService({ activeStudentIds: ['s1', 's2'] });

    const res = await service.recordBatch(
      { courseId: 'course-1', days: [dia('2026-05-12', ['s1', 's2'])] },
      'user-1',
    );

    expect(res).toEqual({ days: 1, upserted: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
