import { AttendanceStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_FORMULA_VERSION,
  addAttendanceStatus,
  buildAttendanceSummary,
  countsAsAttendance,
  emptyAttendanceCounts,
} from './attendance-calculation.js';

describe('attendance calculation', () => {
  it('cuenta PRESENT y LATE como asistencia, pero JUSTIFIED no', () => {
    expect(countsAsAttendance(AttendanceStatus.PRESENT)).toBe(true);
    expect(countsAsAttendance(AttendanceStatus.LATE)).toBe(true);
    expect(countsAsAttendance(AttendanceStatus.JUSTIFIED)).toBe(false);
    expect(countsAsAttendance(AttendanceStatus.ABSENT)).toBe(false);
  });

  it('calcula porcentaje sobre total de clases incluyendo dias sin registro como no asistencia', () => {
    const counts = emptyAttendanceCounts();
    addAttendanceStatus(counts, AttendanceStatus.PRESENT);
    addAttendanceStatus(counts, AttendanceStatus.LATE);
    addAttendanceStatus(counts, AttendanceStatus.JUSTIFIED);
    addAttendanceStatus(counts, AttendanceStatus.ABSENT);

    const summary = buildAttendanceSummary(counts, 5);

    expect(summary).toMatchObject({
      present: 1,
      late: 1,
      justified: 1,
      absent: 1,
      attended: 2,
      totalClasses: 5,
      missing: 1,
      attendanceRate: 0.4,
      formulaVersion: ATTENDANCE_FORMULA_VERSION,
    });
  });

  it('retorna rate null cuando no hay clases en el denominador', () => {
    const summary = buildAttendanceSummary(emptyAttendanceCounts(), 0);

    expect(summary.attendanceRate).toBeNull();
    expect(summary.missing).toBe(0);
  });
});
