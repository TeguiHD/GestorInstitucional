import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import {
  calculateReportAttendanceRate,
  pendingLateWarning,
  ReportsService,
  summarizeReportRecords,
} from './reports.service.js';

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
        { studentId: student.id, date: makeDate(2), status: 'PRESENT', wasLate: false },
        { studentId: student.id, date: makeDate(3), status: 'LATE', wasLate: true },
        { studentId: student.id, date: makeDate(4), status: 'JUSTIFIED', wasLate: false },
        { studentId: student.id, date: makeDate(5), status: 'ABSENT', wasLate: false },
      ]),
    },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
  const schoolConfig = {
    formatDate: vi.fn((date: Date) => date.toISOString().slice(0, 10)),
  };

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

function makeStudentMonthlyService(
  records: Array<{ day: number; status: string; wasLate: boolean }>,
) {
  const prisma = {
    student: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'student-1',
        enrollmentNumber: 1,
        firstName: 'Alumno',
        lastName: 'Prueba',
        secondLastName: null,
        rut: '11.111.111-1',
        enrolledAt: makeDate(1),
        withdrawnAt: null,
        course: {
          name: '1A',
          schoolId: 'school-1',
          school: { id: 'school-1', name: 'Colegio' },
          teachers: [],
        },
      }),
    },
    attendanceRecord: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          records.map((r) => ({ date: makeDate(r.day), status: r.status, wasLate: r.wasLate })),
        ),
    },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
  return new ReportsService(prisma as never, audit as never, calendar as never, {} as never);
}

function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Curso con un alumno y, en marzo 2026: atraso resuelto (2), pendiente (3), P (4), A (5). */
function makeCourseService() {
  const student = {
    id: 'student-1',
    enrollmentNumber: 1,
    firstName: 'Alumno',
    lastName: 'Prueba',
    secondLastName: null,
    rut: '11.111.111-1',
    enrolledAt: makeDate(1),
    withdrawnAt: null,
  };
  const records = [
    { studentId: student.id, date: makeDate(2), status: 'PRESENT', wasLate: true },
    { studentId: student.id, date: makeDate(3), status: 'LATE', wasLate: true },
    { studentId: student.id, date: makeDate(4), status: 'PRESENT', wasLate: false },
    { studentId: student.id, date: makeDate(5), status: 'ABSENT', wasLate: false },
  ];
  const prisma = {
    course: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'course-1',
        name: '1A',
        schoolId: 'school-1',
        school: { id: 'school-1', name: 'Colegio' },
        teachers: [],
        students: [student],
      }),
    },
    student: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        ...student,
        course: {
          name: '1A',
          schoolId: 'school-1',
          school: { id: 'school-1', name: 'Colegio' },
          teachers: [],
        },
      }),
    },
    attendanceRecord: { findMany: vi.fn().mockResolvedValue(records) },
    enrollmentEvent: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
  const marchRange = { from: new Date(2026, 2, 1), to: new Date(2026, 2, 31, 23, 59, 59, 999) };
  const schoolConfig = {
    formatDate: vi.fn(localKey),
    getSemesterPeriod: vi.fn().mockResolvedValue({ ranges: [marchRange] }),
    getAnnualPeriod: vi.fn().mockResolvedValue({ ranges: [marchRange] }),
    monthsForRanges: vi.fn().mockReturnValue([{ month: 3, ...marchRange }]),
    activeDuringRangesWhere: vi.fn().mockReturnValue({}),
    attendanceWhereForRanges: vi.fn().mockReturnValue({}),
    enrollmentWhereForRanges: vi.fn().mockReturnValue({}),
    isDateInRanges: vi.fn().mockReturnValue(true),
    countActiveSchoolDaysInRanges: vi.fn().mockReturnValue(22),
  };
  return new ReportsService(
    prisma as never,
    audit as never,
    calendar as never,
    schoolConfig as never,
  );
}

function sheetContains(sheet: ExcelJS.Worksheet | undefined, text: string): boolean {
  let found = false;
  sheet?.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === 'string' && cell.value.includes(text)) found = true;
    });
  });
  return found;
}

function findRowByLabel(sheet: ExcelJS.Worksheet | undefined, label: string | number): number {
  let found = -1;
  sheet?.eachRow((row, rowNumber) => {
    if (found === -1 && row.getCell(1).value === label) found = rowNumber;
  });
  return found;
}

describe('ReportsService attendance formulas', () => {
  it('calcula la tasa como P sobre (total clases - atrasos pendientes)', () => {
    expect(calculateReportAttendanceRate(2, 5)).toBe(0.4);
    expect(calculateReportAttendanceRate(51, 64)).toBeCloseTo(0.796875);
    expect(calculateReportAttendanceRate(0, 0)).toBe(0);
    expect(calculateReportAttendanceRate(2, 5, 1)).toBe(0.5);
    expect(calculateReportAttendanceRate(0, 1, 1)).toBe(0);
  });

  it('atraso pendiente fuera del numerador y denominador; atraso resuelto cuenta como P y como AT', () => {
    const summary = summarizeReportRecords(
      [
        { status: 'PRESENT', wasLate: false },
        { status: 'PRESENT', wasLate: true }, // atraso resuelto como presente
        { status: 'ABSENT', wasLate: true }, // atraso resuelto como ausente
        { status: 'LATE', wasLate: true }, // atraso pendiente
        { status: 'JUSTIFIED', wasLate: false },
      ],
      6,
    );

    expect(summary.present).toBe(2);
    expect(summary.absent).toBe(1);
    expect(summary.justified).toBe(1);
    expect(summary.late).toBe(3);
    expect(summary.pendingLate).toBe(1);
    expect(summary.effectiveClasses).toBe(5);
    expect(summary.attendanceRate).toBe(0.4);
  });

  it('avisa solo cuando hay atrasos pendientes', () => {
    expect(pendingLateWarning(0)).toBeNull();
    expect(pendingLateWarning(1)).toContain('Hay 1 atraso pendiente de resolver');
    expect(pendingLateWarning(3)).toContain('Hay 3 atrasos pendientes de resolver');
  });

  it('certificado mensual Excel: resuelto suma P y AT, pendiente queda fuera del %', async () => {
    const service = makeStudentMonthlyService([
      { day: 2, status: 'PRESENT', wasLate: true },
      { day: 3, status: 'LATE', wasLate: true },
      { day: 4, status: 'PRESENT', wasLate: false },
      { day: 5, status: 'ABSENT', wasLate: false },
    ]);

    const buffer = await service.generateStudentMonthlyExcel('student-1', 2026, 3, 'user-1');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('ASISTENCIA');

    // Celdas diarias: el resuelto se ve como su estado final, el pendiente como AT.
    const day2 = findRowByLabel(sheet, 2);
    expect(sheet?.getCell(day2, 4).value).toBe('1');
    expect(sheet?.getCell(day2, 5).value).toBe('Atraso resuelto');
    expect(sheet?.getCell(day2 + 1, 4).value).toBe('AT');

    const presentRow = findRowByLabel(sheet, 'Presentes:');
    expect(sheet?.getCell(presentRow, 2).value).toBe(2);
    expect(sheet?.getCell(presentRow, 4).value).toBe(1);
    const lateRow = findRowByLabel(sheet, 'Atrasos:');
    expect(sheet?.getCell(lateRow, 2).value).toBe(2);
    const attendedRow = findRowByLabel(sheet, 'Días asistidos:');
    expect(sheet?.getCell(attendedRow, 2).value).toBe(2);
    // Marzo 2026: 22 días hábiles; 1 atraso pendiente fuera del denominador.
    expect(sheet?.getCell(attendedRow, 4).value).toBe(22);
    const pctRow = findRowByLabel(sheet, '% Asistencia:');
    expect(sheet?.getCell(pctRow, 2).value).toBeCloseTo(2 / 21);
    expect(String(sheet?.getCell(pctRow + 2, 1).value)).toContain('2 * 100 / (22 - 1)');
    expect(String(sheet?.getCell(pctRow + 3, 1).value)).toContain(
      'Hay 1 atraso pendiente de resolver',
    );
  });

  it('genera Excel semanal con justificados, sin registro y atrasos pendientes fuera del %', async () => {
    const { service, audit, calendar } = makeWeeklyService();

    const buffer = await service.generateWeeklyExcel('course-1', '2026-03-02', 'user-1');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('SEMANA');

    // P=1 (el LATE pendiente no suma), A=1, J=1; % = 1 / (5 - 1).
    expect(sheet?.getCell(4, 4).value).toBe('AT');
    expect(sheet?.getCell(4, 10).value).toBe(1);
    expect(sheet?.getCell(4, 11).value).toBe(1);
    expect(sheet?.getCell(4, 12).value).toBe(0.25);
    expect(sheet?.getCell(4, 13).value).toBe(1);
    expect(sheet?.getCell(4, 14).value).toBe(5);
    expect(sheet?.getCell(6, 1).value).toContain(
      '% = Presentes * 100 / (Total clases - Atrasos pendientes)',
    );
    expect(sheet?.getCell(7, 1).value).toContain('Hay 1 atraso pendiente de resolver');
    expect(calendar.getNonSchoolDays).toHaveBeenCalledWith(
      'school-1',
      expect.any(Date),
      expect.any(Date),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXPORT', entity: 'Course' }),
    );
  });

  it('hoja MINEDUC mensual: AT solo en el pendiente, asistencia = P y % sin el pendiente', async () => {
    const service = makeCourseService();

    const buffer = await service.generateCourseExcel('course-1', 2026, 3, 'user-1');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('MARZO');

    expect(sheet?.getCell(14, 6).value).toBe('1'); // 2-mar: atraso resuelto como presente
    expect(sheet?.getCell(14, 7).value).toBe('AT'); // 3-mar: atraso pendiente
    expect(sheet?.getCell(14, 36).value).toBe(2); // ASISTENCIA
    expect(sheet?.getCell(14, 37).value).toBe(1); // AUSENCIA
    expect(sheet?.getCell(14, 38).value).toBe(22); // TOTAL CLASES
    expect(sheet?.getCell(14, 39).value).toBeCloseTo(2 / 21); // % ASIST.
    expect(sheetContains(sheet, 'Atraso pendiente de resolver por Inspectoría')).toBe(true);
    expect(sheetContains(sheet, 'Hay 1 atraso pendiente de resolver')).toBe(true);
  });

  it('resumen semestral del alumno: AT incluye resueltos y el % excluye pendientes', async () => {
    const service = makeCourseService();

    const buffer = await service.generateStudentSemesterExcel('student-1', 2026, 1, 'user-1');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const summary = workbook.getWorksheet('RESUMEN SEMESTRAL');

    // Fila de marzo: P, A, AT, J, Asist., Total clases, %.
    expect(summary?.getCell(3, 2).value).toBe(2);
    expect(summary?.getCell(3, 3).value).toBe(1);
    expect(summary?.getCell(3, 4).value).toBe(2);
    expect(summary?.getCell(3, 5).value).toBe(0);
    expect(summary?.getCell(3, 6).value).toBe(2);
    expect(summary?.getCell(3, 7).value).toBe(22);
    expect(summary?.getCell(3, 8).value).toBeCloseTo(2 / 21);
    expect(sheetContains(summary, '2 * 100 / (22 - 1)')).toBe(true);
    expect(sheetContains(summary, 'Hay 1 atraso pendiente de resolver')).toBe(true);
  });

  it('genera los PDF de curso, grilla MINEDUC y alumno con atrasos pendientes', async () => {
    const service = makeCourseService();
    const pdfs = await Promise.all([
      service.generateCoursePdf('course-1', 2026, 3, 'user-1'),
      service.generateMonthlyGridPdf('course-1', 2026, 3, 'user-1'),
      service.generateSemesterPdf('course-1', 2026, 1, 'user-1'),
      service.generateAnnualPdf('course-1', 2026, 'user-1'),
      service.generateSemesterGridPdf('course-1', 2026, 1, 'user-1'),
      service.generateAnnualGridPdf('course-1', 2026, 'user-1'),
      service.generateStudentMonthlyPdf('student-1', 2026, 3, 'user-1'),
      service.generateStudentSemesterPdf('student-1', 2026, 1, 'user-1'),
      service.generateStudentAnnualPdf('student-1', 2026, 'user-1'),
    ]);
    for (const pdf of pdfs) expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

    const excels = await Promise.all([
      service.generateSemesterExcel('course-1', 2026, 1, 'user-1'),
      service.generateAnnualExcel('course-1', 2026, 'user-1'),
      service.generateStudentAnnualExcel('student-1', 2026, 'user-1'),
    ]);
    for (const xlsx of excels) expect(xlsx.length).toBeGreaterThan(0);
  });
});
