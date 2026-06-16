import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { formatDateOnlyKey, parseDateOnlyUtc } from './date-only.js';

describe('parseDateOnlyUtc', () => {
  it('preserva fechas ISO de input date como dia calendario UTC', () => {
    expect(parseDateOnlyUtc('2026-03-04').toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });

  it('interpreta fechas chilenas como DD/MM/YYYY', () => {
    expect(parseDateOnlyUtc('04/03/2026').toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });

  it('rechaza fechas ambiguas o inexistentes', () => {
    expect(() => parseDateOnlyUtc('03/04/26')).toThrow(BadRequestException);
    expect(() => parseDateOnlyUtc('31/02/2026')).toThrow(BadRequestException);
  });
});

describe('formatDateOnlyKey', () => {
  it('mantiene el dia calendario para fechas UTC midnight', () => {
    expect(formatDateOnlyKey(new Date('2026-05-21T00:00:00.000Z'))).toBe('2026-05-21');
  });

  it('recupera fechas date-only persistidas como tarde UTC del dia anterior', () => {
    expect(formatDateOnlyKey(new Date('2026-05-20T20:00:00.000Z'))).toBe('2026-05-21');
    expect(formatDateOnlyKey(new Date('2026-05-21T20:00:00.000Z'))).toBe('2026-05-22');
  });
});
