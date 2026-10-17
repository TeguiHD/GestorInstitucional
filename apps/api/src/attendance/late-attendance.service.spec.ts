import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { formatDateOnlyKey } from '../common/date-only.js';
import { LateAttendanceService } from './late-attendance.service.js';

const INSPECTORA = { sub: 'user-insp', schoolId: 'school-1', roles: ['INSPECTORIA'] } as never;
const PROFESOR = { sub: 'user-prof', schoolId: 'school-1', roles: ['PROFESOR'] } as never;

function record(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    studentId: `student-${id}`,
    courseId: 'course-1',
    date: new Date('2026-10-14T00:00:00.000Z'),
    status: 'LATE',
    wasLate: true,
    course: { id: 'course-1', code: '1A', name: 'Primero A', schoolId: 'school-1' },
    student: {
      firstName: 'Ana',
      lastName: 'Pérez',
      secondLastName: null,
      enrollmentNumber: 3,
    },
    ...overrides,
  };
}

function makeService(records: ReturnType<typeof record>[], updatedCount = records.length) {
  const tx = {
    attendanceRecord: { updateMany: vi.fn().mockResolvedValue({ count: updatedCount }) },
  };
  const prisma = {
    attendanceRecord: {
      findMany: vi.fn().mockResolvedValue(records),
      count: vi.fn().mockResolvedValue(records.length),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as []),
    ),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const schoolConfig = { formatDate: vi.fn((d: Date) => formatDateOnlyKey(d)) };
  return {
    service: new LateAttendanceService(prisma as never, audit as never, schoolConfig as never),
    prisma,
    tx,
    audit,
  };
}

describe('LateAttendanceService.resolve', () => {
  it('resuelve en lote, conserva la marca de atraso y audita por curso', async () => {
    const { service, tx, audit } = makeService([record('r1'), record('r2')]);

    const result = await service.resolve(INSPECTORA, {
      recordIds: ['r1', 'r2'],
      status: 'PRESENT',
    });

    expect(result).toEqual({ resolved: 2 });
    expect(tx.attendanceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r2'] }, status: 'LATE' },
      data: expect.objectContaining({
        status: 'PRESENT',
        wasLate: true,
        recordedById: 'user-insp',
      }),
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
    const meta = audit.log.mock.calls[0]![0].meta;
    expect(meta).toMatchObject({ attendanceChange: true, lateResolution: true });
    expect(meta.changes).toHaveLength(2);
    expect(meta.changes[0]).toMatchObject({
      previousStatus: 'LATE',
      newStatus: 'PRESENT',
      date: '2026-10-14',
      studentName: 'Ana Pérez',
      changedFields: ['status'],
    });
  });

  it('rechaza si alguno ya no está pendiente (otra persona lo resolvió) sin escribir nada', async () => {
    const { service, tx } = makeService([record('r1'), record('r2', { status: 'PRESENT' })]);

    await expect(
      service.resolve(INSPECTORA, { recordIds: ['r1', 'r2'], status: 'ABSENT' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.attendanceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('revierte si otro guardado cambió un registro entre la lectura y la escritura', async () => {
    const { service } = makeService([record('r1'), record('r2')], 1);

    await expect(
      service.resolve(INSPECTORA, { recordIds: ['r1', 'r2'], status: 'PRESENT' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza registros inexistentes', async () => {
    const { service } = makeService([record('r1')]);

    await expect(
      service.resolve(INSPECTORA, { recordIds: ['r1', 'nope'], status: 'PRESENT' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no deja resolver registros de otro colegio ni a un profesor', async () => {
    const other = record('r1', {
      course: { id: 'c9', code: '9A', name: 'Otro', schoolId: 'school-2' },
    });
    await expect(
      makeService([other]).service.resolve(INSPECTORA, { recordIds: ['r1'], status: 'PRESENT' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      makeService([record('r1')]).service.resolve(PROFESOR, {
        recordIds: ['r1'],
        status: 'PRESENT',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('LateAttendanceService.list', () => {
  it('pendientes = status LATE; resueltos = con marca y otro estado', async () => {
    const { service, prisma } = makeService([record('r1')]);

    const res = await service.list('school-1', INSPECTORA, { state: 'pending' });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: 'r1', date: '2026-10-14', status: 'LATE' });
    expect(prisma.attendanceRecord.findMany.mock.calls[0]![0].where).toMatchObject({
      status: 'LATE',
      course: { schoolId: 'school-1' },
    });

    await service.list('school-1', INSPECTORA, { state: 'resolved', courseId: 'course-1' });
    expect(prisma.attendanceRecord.findMany.mock.calls[1]![0].where).toMatchObject({
      wasLate: true,
      status: { not: 'LATE' },
      courseId: 'course-1',
    });
  });

  it('no deja listar otro colegio', async () => {
    await expect(
      makeService([]).service.list('school-2', INSPECTORA, { state: 'pending' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
