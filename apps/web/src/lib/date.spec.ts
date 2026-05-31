import { describe, expect, it } from 'vitest';

import { dateInputValue, fmtDateCl } from './date';

describe('date helpers', () => {
  it('convierte fechas chilenas al valor ISO que espera input date', () => {
    expect(dateInputValue('04/03/2026')).toBe('2026-03-04');
  });

  it('muestra fechas ISO del backend como DD/MM/YYYY sin reinterpretar zona horaria', () => {
    expect(fmtDateCl('2026-03-04T00:00:00.000Z')).toBe('04/03/2026');
  });
});
