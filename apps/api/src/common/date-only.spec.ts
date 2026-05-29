import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseDateOnlyUtc } from './date-only.js';

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
