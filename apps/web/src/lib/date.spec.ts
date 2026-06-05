import { describe, expect, it } from 'vitest';

import { dateInputValue, fmtDateCl, formatDateLocal } from './date';

describe('date helpers', () => {
  it('convierte fechas chilenas al valor ISO que espera input date', () => {
    expect(dateInputValue('04/03/2026')).toBe('2026-03-04');
  });

  it('muestra fechas ISO del backend como DD/MM/YYYY sin reinterpretar zona horaria', () => {
    expect(fmtDateCl('2026-03-04T00:00:00.000Z')).toBe('04/03/2026');
  });

  it('formatea Date con día local para rangos visibles', () => {
    expect(formatDateLocal(new Date(2026, 2, 4, 23, 30))).toBe('2026-03-04');
  });
});
