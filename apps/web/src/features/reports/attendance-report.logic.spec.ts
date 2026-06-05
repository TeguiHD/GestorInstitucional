import { describe, expect, it } from 'vitest';

import {
  attendedDays,
  attendancePercent,
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

  it('cuenta atraso como día asistido y no suma justificados', () => {
    const stats = { present: 50, late: 1, justified: 10, totalClasses: 64 };

    expect(attendedDays(stats)).toBe(51);
    expect(attendancePercent(stats)).toBeCloseTo(51 / 64);
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
});
