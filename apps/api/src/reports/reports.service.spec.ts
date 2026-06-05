import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import { calculateReportAttendanceRate, ReportsService } from './reports.service.js';

function makeDate(day: number) {
  return new Date(`2026-03-${String(day).padStart(2, '0')}T12:00:00`);
}

function makeWeeklyService() {
  const student = {
    id: 'student-1',
    enrollmentNumber: 1,
    firstName: 'Alumno',
    lastName: 'Prueba',
    secondLastName: null,
    enrolledAt: makeDate(1),
    withdrawnAt: null,
  };
  const prisma = {
    course: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'course-1',
        name: '1A',
        school: { id: 'school-1', name: 'Colegio' },
        teachers: [],
        students: [student],
      }),
    },
    attendanceRecord: {
      findMany: vi.fn().mockResolvedValue([
        { studentId: student.id, date: makeDate(2), status: 'PRESENT' },
        { studentId: student.id, date: makeDate(3), status: 'LATE' },
        { studentId: student.id, date: makeDate(4), status: 'JUSTIFIED' },
        { studentId: student.id, date: makeDate(5), status: 'ABSENT' },
      ]),
    },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
  const schoolConfig = {};

  return {
    service: new ReportsService(
      prisma as never,
      audit as never,
      calendar as never,
      schoolConfig as never,
    ),
    audit,
    calendar,
  };
}

describe('ReportsService attendance formulas', () => {
  it('calcula tasa institucional como P + AT sobre total clases', () => {
    expect(calculateReportAttendanceRate(2, 5)).toBe(0.4);
    expect(calculateReportAttendanceRate(51, 64)).toBeCloseTo(0.796875);
    expect(calculateReportAttendanceRate(0, 0)).toBe(0);
  });

  it('genera Excel semanal con justificados y sin registro fuera del numerador', async () => {
    const { service, audit, calendar } = makeWeeklyService();

    const buffer = await service.generateWeeklyExcel('course-1', '2026-03-02', 'user-1');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('SEMANA');

    expect(sheet?.getCell(4, 10).value).toBe(2);
    expect(sheet?.getCell(4, 11).value).toBe(1);
    expect(sheet?.getCell(4, 12).value).toBe(0.4);
    expect(sheet?.getCell(4, 13).value).toBe(1);
    expect(sheet?.getCell(4, 14).value).toBe(5);
    expect(sheet?.getCell(6, 1).value).toContain('(Presentes + Atrasos) * 100 / Total clases');
    expect(calendar.getNonSchoolDays).toHaveBeenCalledWith(
      'school-1',
      expect.any(Date),
      expect.any(Date),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXPORT', entity: 'Course' }),
    );
  });
});
