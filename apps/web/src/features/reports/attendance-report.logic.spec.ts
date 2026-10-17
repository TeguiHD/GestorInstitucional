import { describe, expect, it } from 'vitest';

import {
  attendedDays,
  attendancePercent,
  effectiveClasses,
  manualFormulaText,
  statusDatesForStudent,
  totalClasses,
} from './attendance-report.logic';

describe('attendance report logic', () => {
  it('muestra cálculo manual como días asistidos por total clases', () => {
    const stats = { present: 51, late: 0, totalClasses: 64 };

    expect(attendedDays(stats)).toBe(51);
    expect(totalClasses(stats)).toBe(64);
    expect(attendancePercent(stats)).toBeCloseTo(51 / 64);
    expect(manualFormulaText(stats)).toBe('51 * 100 / 64');
  });

  it('un atraso resuelto no suma por sí mismo y no se suman justificados', () => {
    const stats = { present: 50, late: 1, justified: 10, totalClasses: 64 };

    expect(attendedDays(stats)).toBe(50);
    expect(attendancePercent(stats)).toBeCloseTo(50 / 64);
  });

  it('excluye los atrasos pendientes del numerador y del denominador', () => {
    const stats = { present: 50, late: 3, pendingLate: 2, totalClasses: 64 };

    expect(attendedDays(stats)).toBe(50);
    expect(effectiveClasses(stats)).toBe(62);
    expect(attendancePercent(stats)).toBeCloseTo(50 / 62);
    expect(manualFormulaText(stats)).toBe('50 * 100 / (64 − 2)');
  });

  it('prefiere attended del backend y devuelve null sin clases efectivas', () => {
    expect(attendedDays({ attended: 7, present: 9 })).toBe(7);
    expect(attendancePercent({ present: 0, pendingLate: 2, totalClasses: 2 })).toBeNull();
  });

  it('filtra fechas por alumno y estado para revisión manual', () => {
    const dates = statusDatesForStudent(
      [
        {
          dates: ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'],
          matrix: {
            s1: {
              '2026-03-02': 'ABSENT',
              '2026-03-03': 'LATE',
              '2026-03-04': 'JUSTIFIED',
              '2026-03-05': 'ABSENT',
            },
            s2: { '2026-03-02': 'ABSENT' },
          },
        },
      ],
      's1',
      'ABSENT',
    );

    expect(dates).toEqual(['2026-03-02', '2026-03-05']);
  });

  it('para atrasos incluye los pendientes y los ya resueltos (marca de atraso)', () => {
    const dates = statusDatesForStudent(
      [
        {
          dates: ['2026-03-02', '2026-03-03', '2026-03-04'],
          matrix: {
            s1: { '2026-03-02': 'PRESENT', '2026-03-03': 'LATE', '2026-03-04': 'ABSENT' },
          },
          lateMarks: { s1: ['2026-03-02', '2026-03-03'] },
        },
      ],
      's1',
      'LATE',
    );

    expect(dates).toEqual(['2026-03-02', '2026-03-03']);
  });
});
