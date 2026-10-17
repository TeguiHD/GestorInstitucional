import { AttendanceStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_FORMULA_VERSION,
  addAttendanceStatus,
  buildAttendanceSummary,
  countsAsAbsence,
  countsAsAttendance,
  emptyAttendanceCounts,
  isPendingLate,
  nextWasLate,
  statusAfterJustification,
} from './attendance-calculation.js';

describe('attendance calculation', () => {
  it('solo PRESENT cuenta como asistencia; un atraso pendiente no es asistencia ni ausencia', () => {
    expect(countsAsAttendance(AttendanceStatus.PRESENT)).toBe(true);
    expect(countsAsAttendance(AttendanceStatus.LATE)).toBe(false);
    expect(countsAsAttendance(AttendanceStatus.JUSTIFIED)).toBe(false);
    expect(countsAsAttendance(AttendanceStatus.ABSENT)).toBe(false);

    expect(isPendingLate(AttendanceStatus.LATE)).toBe(true);
    expect(countsAsAbsence(AttendanceStatus.LATE)).toBe(false);
    expect(countsAsAbsence(AttendanceStatus.ABSENT)).toBe(true);
    expect(countsAsAbsence(AttendanceStatus.JUSTIFIED)).toBe(true);
    expect(countsAsAbsence(AttendanceStatus.PRESENT)).toBe(false);
  });

  it('excluye los atrasos pendientes del numerador y del denominador', () => {
    const counts = emptyAttendanceCounts();
    addAttendanceStatus(counts, AttendanceStatus.PRESENT);
    addAttendanceStatus(counts, AttendanceStatus.LATE, true);
    addAttendanceStatus(counts, AttendanceStatus.JUSTIFIED);
    addAttendanceStatus(counts, AttendanceStatus.ABSENT);

    const summary = buildAttendanceSummary(counts, 5);

    expect(summary).toMatchObject({
      present: 1,
      late: 1,
      pendingLate: 1,
      justified: 1,
      absent: 1,
      attended: 1,
      totalClasses: 5,
      effectiveClasses: 4,
      missing: 1,
      attendanceRate: 0.25,
      formulaVersion: ATTENDANCE_FORMULA_VERSION,
    });
  });

  it('un atraso resuelto cuenta por su estado final y conserva el conteo de atrasos', () => {
    const counts = emptyAttendanceCounts();
    addAttendanceStatus(counts, AttendanceStatus.PRESENT, true);
    addAttendanceStatus(counts, AttendanceStatus.ABSENT, true);
    addAttendanceStatus(counts, AttendanceStatus.PRESENT);

    const summary = buildAttendanceSummary(counts, 3);

    expect(summary).toMatchObject({
      present: 2,
      absent: 1,
      late: 2,
      pendingLate: 0,
      effectiveClasses: 3,
      attendanceRate: 2 / 3,
    });
  });

  it('un LATE sin marca explícita igual cuenta como atraso (pendiente)', () => {
    const counts = emptyAttendanceCounts();
    addAttendanceStatus(counts, AttendanceStatus.LATE);
    expect(counts).toMatchObject({ late: 1, pendingLate: 1 });
  });

  it('retorna rate null cuando no hay clases en el denominador', () => {
    const summary = buildAttendanceSummary(emptyAttendanceCounts(), 0);

    expect(summary.attendanceRate).toBeNull();
    expect(summary.missing).toBe(0);
  });

  it('retorna rate null cuando todas las clases son atrasos pendientes', () => {
    const counts = emptyAttendanceCounts();
    addAttendanceStatus(counts, AttendanceStatus.LATE, true);
    const summary = buildAttendanceSummary(counts, 1);

    expect(summary.effectiveClasses).toBe(0);
    expect(summary.attendanceRate).toBeNull();
  });
});

describe('nextWasLate', () => {
  it('guardar LATE marca el atraso', () => {
    expect(nextWasLate(undefined, AttendanceStatus.LATE, false)).toBe(true);
    expect(nextWasLate({ status: 'PRESENT', wasLate: false }, AttendanceStatus.LATE, false)).toBe(
      true,
    );
  });

  it('un registro nuevo que no es atraso no lleva marca', () => {
    expect(nextWasLate(undefined, AttendanceStatus.PRESENT, true)).toBe(false);
  });

  it('Inspectoría resuelve un pendiente: conserva la marca', () => {
    expect(nextWasLate({ status: 'LATE', wasLate: true }, AttendanceStatus.PRESENT, true)).toBe(
      true,
    );
    expect(nextWasLate({ status: 'LATE', wasLate: true }, AttendanceStatus.ABSENT, true)).toBe(
      true,
    );
  });

  it('el profesor corrige un atraso mal marcado: quita la marca', () => {
    expect(nextWasLate({ status: 'LATE', wasLate: true }, AttendanceStatus.PRESENT, false)).toBe(
      false,
    );
  });

  it('un atraso ya resuelto conserva la marca aunque cambie el estado final', () => {
    expect(nextWasLate({ status: 'PRESENT', wasLate: true }, AttendanceStatus.ABSENT, false)).toBe(
      true,
    );
    expect(nextWasLate({ status: 'ABSENT', wasLate: false }, AttendanceStatus.PRESENT, true)).toBe(
      false,
    );
  });
});

describe('statusAfterJustification', () => {
  it('un atraso justificado queda presente (pendiente o ya resuelto como ausente)', () => {
    expect(statusAfterJustification({ status: 'LATE', wasLate: true })).toBe('PRESENT');
    expect(statusAfterJustification({ status: 'ABSENT', wasLate: true })).toBe('PRESENT');
  });

  it('una inasistencia justificada queda JUSTIFIED', () => {
    expect(statusAfterJustification({ status: 'ABSENT', wasLate: false })).toBe('JUSTIFIED');
  });
});
