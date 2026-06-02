import { BadRequestException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceService } from './attendance.service.js';
import type { RecordAttendanceDto } from './dto/record-attendance.dto.js';

function dto(entries: RecordAttendanceDto['entries']): RecordAttendanceDto {
  return {
    courseId: 'course-1',
    date: '2026-05-12',
    entries,
  };
}

function makeService(params: { activeStudentIds: string[]; existingStudentIds?: string[] }) {
  const prisma = {
    student: {
      findMany: vi.fn().mockResolvedValue(params.activeStudentIds.map((id) => ({ id }))),
    },
    attendanceRecord: {
      findMany: vi
        .fn()
        .mockResolvedValue((params.existingStudentIds ?? []).map((studentId) => ({ studentId }))),
      upsert: vi.fn((args) => args),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
  const mail = { sendAbsenceDaily: vi.fn() };
  const whatsapp = { sendAbsenceAlert: vi.fn() };
  const schoolConfig = {};

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
});
