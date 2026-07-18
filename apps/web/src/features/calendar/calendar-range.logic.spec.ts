import { describe, expect, it } from 'vitest';

import { buildRangeDayKeys } from './calendar-range.logic';

describe('buildRangeDayKeys', () => {
  it('caso vacaciones de invierno CSSP: salta findes y el feriado existente 29-jun', () => {
    const plan = buildRangeDayKeys('2026-06-19', '2026-07-03', new Set(['2026-06-29']));
    expect(plan).toEqual({
      ok: true,
      create: [
        '2026-06-19',
        '2026-06-22',
        '2026-06-23',
        '2026-06-24',
        '2026-06-25',
        '2026-06-26',
        '2026-06-30',
        '2026-07-01',
        '2026-07-02',
        '2026-07-03',
      ],
      skippedExisting: ['2026-06-29'],
      skippedWeekends: 4,
    });
  });

  it('un solo dia habil (from == to)', () => {
    expect(buildRangeDayKeys('2026-07-20', '2026-07-20', new Set())).toEqual({
      ok: true,
      create: ['2026-07-20'],
      skippedExisting: [],
      skippedWeekends: 0,
    });
  });

  it('un solo dia en fin de semana crea cero', () => {
    expect(buildRangeDayKeys('2026-07-25', '2026-07-25', new Set())).toEqual({
      ok: true,
      create: [],
      skippedExisting: [],
      skippedWeekends: 1,
    });
  });

  it('hasta < desde es rango invalido', () => {
    expect(buildRangeDayKeys('2026-07-03', '2026-06-19', new Set())).toEqual({
      ok: false,
      error: 'INVALID_RANGE',
    });
  });

  it('rango que cruza de año es invalido (mapa de existentes es por año)', () => {
    expect(buildRangeDayKeys('2026-12-28', '2027-01-05', new Set())).toEqual({
      ok: false,
      error: 'INVALID_RANGE',
    });
  });

  it('mas de 60 dias inclusivos es demasiado grande', () => {
    expect(buildRangeDayKeys('2026-01-01', '2026-03-15', new Set())).toEqual({
      ok: false,
      error: 'RANGE_TOO_LARGE',
    });
  });

  it('60 dias exactos es valido', () => {
    const plan = buildRangeDayKeys('2026-01-01', '2026-03-01', new Set());
    expect(plan.ok).toBe(true);
  });
});
