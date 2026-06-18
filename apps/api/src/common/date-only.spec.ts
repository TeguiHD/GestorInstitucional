import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  chileTodayEndUtc,
  chileTodayKey,
  dateKeyInTz,
  formatDateOnlyKey,
  parseDateOnlyUtc,
} from './date-only.js';

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

describe('formatDateOnlyKey (clave canonica UTC, independiente de TZ)', () => {
  it('devuelve el dia calendario para @db.Date materializado a medianoche UTC', () => {
    expect(formatDateOnlyKey(new Date('2026-05-21T00:00:00.000Z'))).toBe('2026-05-21');
  });

  it('NO corre el dia cuando Prisma materializa a medianoche LOCAL (04:00Z bajo Santiago)', () => {
    // Una columna @db.Date nunca trae hora; si el motor la ancla a medianoche
    // local chilena (UTC-4) sigue siendo el MISMO dia calendario.
    expect(formatDateOnlyKey(new Date('2026-05-21T04:00:00.000Z'))).toBe('2026-05-21');
  });

  it('es deterministica y NO suma un dia a valores de tarde-UTC (sin band-aid +1)', () => {
    // El viejo guard +1 convertia esto en 2026-05-22 y fabricaba el corrimiento.
    expect(formatDateOnlyKey(new Date('2026-05-21T20:00:00.000Z'))).toBe('2026-05-21');
  });
});

describe('dateKeyInTz (dia calendario real en una zona horaria)', () => {
  it('da el dia chileno correcto en la madrugada UTC (noche anterior en Chile)', () => {
    // 2026-06-18 02:30Z = 2026-06-17 22:30 en Chile (UTC-4) -> sigue siendo el 17.
    expect(dateKeyInTz(new Date('2026-06-18T02:30:00.000Z'), 'America/Santiago')).toBe(
      '2026-06-17',
    );
  });

  it('da el dia chileno correcto al mediodia UTC', () => {
    expect(dateKeyInTz(new Date('2026-06-17T12:00:00.000Z'), 'America/Santiago')).toBe(
      '2026-06-17',
    );
  });

  it('chileTodayKey acepta un instante inyectado y usa America/Santiago', () => {
    expect(chileTodayKey(new Date('2026-06-18T02:30:00.000Z'))).toBe('2026-06-17');
  });

  it('chileTodayEndUtc ancla el fin del dia chileno a medianoche UTC', () => {
    expect(chileTodayEndUtc(new Date('2026-06-18T02:30:00.000Z')).toISOString()).toBe(
      '2026-06-17T23:59:59.999Z',
    );
  });
});
