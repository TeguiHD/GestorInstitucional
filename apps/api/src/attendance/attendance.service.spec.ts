import { BadRequestException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { formatDateOnlyKey } from '../common/date-only.js';
import { AttendanceService } from './attendance.service.js';
import type { RecordAttendanceDto } from './dto/record-attendance.dto.js';

function dto(entries: RecordAttendanceDto['entries']): RecordAttendanceDto {
  return {
    courseId: 'course-1',
    date: '2026-05-12',
    entries,
  };
}

type RawExisting = {
  studentId: string;
  date: Date;
  status?: AttendanceStatus;
};

function makeService(params: {
  activeStudentIds: string[];
  existingStudentIds?: string[];
  /** Registros existentes con fecha arbitraria (para probar contaminación entre días). */
  existingRecords?: RawExisting[];
}) {
  const rawExisting: RawExisting[] =
    params.existingRecords ??
    (params.existingStudentIds ?? []).map((studentId) => ({
      studentId,
      date: new Date('2026-05-12T00:00:00.000Z'),
    }));
  const existingRecords = rawExisting.map((r) => ({
    id: `record-${r.studentId}-${r.date.toISOString().slice(0, 10)}`,
    studentId: r.studentId,
    date: r.date,
    status: r.status ?? AttendanceStatus.PRESENT,
    lateMinutes: null,
    note: null,
  }));
  const prisma = {
    student: {
      findMany: vi.fn().mockResolvedValue(params.activeStudentIds.map((id) => ({ id }))),
    },
    attendanceRecord: {
      findMany: vi.fn().mockResolvedValue(existingRecords),
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
  const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
  const mail = { sendAbsenceDaily: vi.fn() };
  const whatsapp = { sendAbsenceAlert: vi.fn() };
  const schoolConfig = {
    // Usa la clave canónica real (UTC), no un atajo, para ejercer el contrato real.
    formatDate: vi.fn((date: Date) => formatDateOnlyKey(date)),
  };

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
    calendar,
  };
}

describe('AttendanceService.recordBulk', () => {
  it('rechaza un día nuevo si no vienen todos los alumnos activos', async () => {
    const { service, prisma } = makeService({ activeStudentIds: ['s1', 's2'] });

    await expect(
      service.recordBulk(dto([{ studentId: 's1', status: AttendanceStatus.PRESENT }]), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('acepta edición parcial cuando el día ya está completo', async () => {
    const { service, prisma } = makeService({
      activeStudentIds: ['s1', 's2'],
      existingStudentIds: ['s1', 's2'],
    });

    await expect(
      service.recordBulk(dto([{ studentId: 's1', status: AttendanceStatus.PRESENT }]), 'user-1'),
    ).resolves.toEqual({ upserted: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('acepta completar un día parcial', async () => {
    const { service, prisma } = makeService({
      activeStudentIds: ['s1', 's2'],
      existingStudentIds: ['s1'],
    });

    await expect(
      service.recordBulk(dto([{ studentId: 's2', status: AttendanceStatus.PRESENT }]), 'user-1'),
    ).resolves.toEqual({ upserted: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rechaza alumnos fuera del curso o período activo', async () => {
    const { service, prisma } = makeService({ activeStudentIds: ['s1'] });

    await expect(
      service.recordBulk(dto([{ studentId: 's2', status: AttendanceStatus.PRESENT }]), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('NO cuenta registros del día siguiente como cobertura del día objetivo', async () => {
    // Regresión: bajo TZ Chile, keyFromLocal de un @db.Date medianoche-UTC del 13
    // devolvía "2026-05-12" y contaminaba la cobertura del día 12.
    const { service, prisma } = makeService({
      activeStudentIds: ['s1', 's2'],
      existingRecords: [
        { studentId: 's1', date: new Date('2026-05-12T00:00:00.000Z') },
        { studentId: 's2', date: new Date('2026-05-13T00:00:00.000Z') },
      ],
    });

    await expect(
      service.recordBulk(dto([{ studentId: 's1', status: AttendanceStatus.PRESENT }]), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('permite justificar a un alumno en un día completo y actualiza SU registro', async () => {
    // Síntoma reportado: 'A' (ABSENT) que no se deja pasar a JUSTIFIED.
    const { service, prisma } = makeService({
      activeStudentIds: ['s1', 's2'],
      existingRecords: [
        {
          studentId: 's1',
          date: new Date('2026-05-12T00:00:00.000Z'),
          status: AttendanceStatus.ABSENT,
        },
        {
          studentId: 's2',
          date: new Date('2026-05-12T00:00:00.000Z'),
          status: AttendanceStatus.PRESENT,
        },
      ],
    });

    await expect(
      service.recordBulk(dto([{ studentId: 's1', status: AttendanceStatus.JUSTIFIED }]), 'user-1'),
    ).resolves.toEqual({ upserted: 1 });
    expect(prisma.attendanceRecord.update).toHaveBeenCalledTimes(1);
    const arg = prisma.attendanceRecord.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: AttendanceStatus };
    };
    expect(arg.where.id).toBe('record-s1-2026-05-12');
    expect(arg.data.status).toBe(AttendanceStatus.JUSTIFIED);
  });

  it('escribe la fecha como medianoche UTC del día, sin corrimiento por TZ', async () => {
    const { service, prisma } = makeService({ activeStudentIds: ['s1', 's2'] });

    await service.recordBulk(
      dto([
        { studentId: 's1', status: AttendanceStatus.PRESENT },
        { studentId: 's2', status: AttendanceStatus.PRESENT },
      ]),
      'user-1',
    );

    expect(prisma.attendanceRecord.create).toHaveBeenCalledTimes(2);
    const created = prisma.attendanceRecord.create.mock.calls[0]![0] as { data: { date: Date } };
    expect(created.data.date.toISOString()).toBe('2026-05-12T00:00:00.000Z');
  });
});

describe('AttendanceService.getMissingAttendance', () => {
  const VACATION_DAYS = [
    '2026-06-19',
    '2026-06-22',
    '2026-06-23',
    '2026-06-24',
    '2026-06-25',
    '2026-06-26',
  ];

  function recordsOn(dates: string[]) {
    return dates.map((date) => ({
      courseId: 'course-1',
      date: new Date(`${date}T00:00:00.000Z`),
    }));
  }

  it('no cuenta como pendientes los días no lectivos (vacaciones entre semestres)', async () => {
    const { service, prisma, calendar } = makeService({ activeStudentIds: [] });
    calendar.getNonSchoolDays.mockResolvedValue(new Set(VACATION_DAYS));
    prisma.attendanceRecord.findMany = vi
      .fn()
      .mockResolvedValue(recordsOn(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18']));

    const result = await service.getMissingAttendance('school-1', '2026-06-15', '2026-06-26');

    expect(result).toEqual([]);
  });

  it('sigue reportando días lectivos sin registro', async () => {
    const { service, prisma, calendar } = makeService({ activeStudentIds: [] });
    calendar.getNonSchoolDays.mockResolvedValue(new Set(VACATION_DAYS));
    prisma.attendanceRecord.findMany = vi
      .fn()
      .mockResolvedValue(recordsOn(['2026-06-15', '2026-06-17', '2026-06-18']));

    const result = await service.getMissingAttendance('school-1', '2026-06-15', '2026-06-26');

    expect(result).toEqual([
      expect.objectContaining({ courseId: 'course-1', missingDates: ['2026-06-16'] }),
    ]);
  });
});
