import { describe, expect, it } from 'vitest';

import {
  getVacationBanners,
  getVacationInfo,
  shiftDateKey,
  type AcademicYearConfig,
} from './calendar-vacations.logic';

// Config real de prod 2026 (semestres guardados en school_academic_year_configs)
const config2026: AcademicYearConfig = {
  firstSemester: { startDate: '2026-03-04', endDate: '2026-06-18' },
  secondSemester: { startDate: '2026-07-06', endDate: '2026-12-31' },
};

describe('shiftDateKey', () => {
  it('suma y resta dias cruzando limites de mes y año', () => {
    expect(shiftDateKey('2026-06-18', 1)).toBe('2026-06-19');
    expect(shiftDateKey('2026-07-06', -1)).toBe('2026-07-05');
    expect(shiftDateKey('2026-06-30', 1)).toBe('2026-07-01');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('getVacationInfo', () => {
  it('marca invierno solo estrictamente entre semestres (19-jun a 5-jul)', () => {
    expect(getVacationInfo('2026-06-18', config2026)).toBeNull();
    expect(getVacationInfo('2026-06-19', config2026)).toEqual({
      kind: 'winter',
      label: 'Vacaciones de invierno',
    });
    expect(getVacationInfo('2026-07-05', config2026)?.kind).toBe('winter');
    expect(getVacationInfo('2026-07-06', config2026)).toBeNull();
  });

  it('marca verano antes del inicio y despues del fin del año escolar', () => {
    expect(getVacationInfo('2026-01-15', config2026)).toEqual({
      kind: 'summer',
      label: 'Vacaciones de verano',
    });
    expect(getVacationInfo('2026-03-03', config2026)?.kind).toBe('summer');
    expect(getVacationInfo('2026-03-04', config2026)).toBeNull();
    expect(getVacationInfo('2026-12-31', config2026)).toBeNull();
  });

  it('dias lectivos normales retornan null', () => {
    expect(getVacationInfo('2026-05-11', config2026)).toBeNull();
    expect(getVacationInfo('2026-08-10', config2026)).toBeNull();
  });

  it('sin config (query en error o cargando) retorna null siempre', () => {
    expect(getVacationInfo('2026-06-25', undefined)).toBeNull();
  });

  it('config malformada (respuesta inesperada) retorna null en vez de romper', () => {
    const broken = {
      firstSemester: { startDate: '', endDate: '2026-06-18' },
      secondSemester: { startDate: '2026-07-06', endDate: '2026-12-31' },
    } as AcademicYearConfig;
    expect(getVacationInfo('2026-06-25', broken)).toBeNull();
  });
});

describe('getVacationBanners', () => {
  it('retorna verano de inicio e invierno para 2026 (sin verano fin de año)', () => {
    expect(getVacationBanners(2026, config2026)).toEqual([
      {
        kind: 'summer',
        label: 'Vacaciones de verano',
        from: '2026-01-01',
        to: '2026-03-03',
        returnDate: '2026-03-04',
      },
      {
        kind: 'winter',
        label: 'Vacaciones de invierno',
        from: '2026-06-19',
        to: '2026-07-05',
        returnDate: '2026-07-06',
      },
    ]);
  });

  it('semestres contiguos no generan franja de invierno', () => {
    const contiguous: AcademicYearConfig = {
      firstSemester: { startDate: '2026-03-04', endDate: '2026-06-18' },
      secondSemester: { startDate: '2026-06-19', endDate: '2026-12-31' },
    };
    expect(getVacationBanners(2026, contiguous).map((b) => b.kind)).toEqual(['summer']);
  });

  it('semestre 2 que termina antes del 31-dic genera verano de fin de año sin retorno', () => {
    const early: AcademicYearConfig = {
      firstSemester: { startDate: '2026-03-04', endDate: '2026-06-18' },
      secondSemester: { startDate: '2026-07-06', endDate: '2026-12-11' },
    };
    expect(getVacationBanners(2026, early).at(-1)).toEqual({
      kind: 'summer',
      label: 'Vacaciones de verano',
      from: '2026-12-12',
      to: '2026-12-31',
      returnDate: null,
    });
  });

  it('sin config retorna lista vacia', () => {
    expect(getVacationBanners(2026, undefined)).toEqual([]);
  });
});
