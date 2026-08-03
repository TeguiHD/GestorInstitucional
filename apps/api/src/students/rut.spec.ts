import { describe, expect, it } from 'vitest';

import { isValidRut, normalizeRut } from './rut.js';

describe('RUT chileno', () => {
  it('normaliza puntos, espacios y K minúscula', () => {
    expect(normalizeRut(' 12.345.678-k ')).toBe('12345678-K');
  });

  it('valida dígito verificador módulo 11', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('12345678-5')).toBe(true);
    expect(isValidRut('12345678-9')).toBe(false);
  });

  it('rechaza formatos fuera del estándar institucional', () => {
    expect(isValidRut('1-9')).toBe(false);
    expect(isValidRut('abcdefg-k')).toBe(false);
  });
});

describe('IPE — Identificador Provisorio Escolar (MINEDUC)', () => {
  // El IPE se asigna a alumnos migrantes sin RUT chileno. Tiene 9 dígitos
  // (los chilenos tienen 7-8) y su DV se calcula con el mismo módulo 11.
  // Estos son los IPE reales que ya están matriculados en el CSSP.
  const ipesReales = [
    '100648936-9',
    '100686027-K',
    '100714826-3',
    '100802941-1',
    '100791976-6',
    '100791980-4',
    '100755208-0',
  ];

  it('acepta los IPE de 9 dígitos ya matriculados', () => {
    for (const ipe of ipesReales) {
      expect(isValidRut(ipe), `${ipe} debería ser válido`).toBe(true);
    }
  });

  it('valida el dígito verificador del IPE con el mismo módulo 11', () => {
    expect(isValidRut('100448352-5')).toBe(true);
    expect(isValidRut('100448352-4')).toBe(false);
  });

  it('sigue rechazando largos que no son ni RUT ni IPE', () => {
    expect(isValidRut('123456-7')).toBe(false); // 6 dígitos
    expect(isValidRut('1234567890-1')).toBe(false); // 10 dígitos
  });
});

describe('normalizeRut — entrada sin guion', () => {
  // Los formularios reciben el identificador pegado desde planillas del colegio,
  // donde suele venir sin guion. El último carácter siempre es el DV.
  it('inserta el guion en un IPE escrito de corrido', () => {
    expect(normalizeRut('1004483525')).toBe('100448352-5');
  });

  it('inserta el guion en un RUT escrito de corrido', () => {
    expect(normalizeRut('123456785')).toBe('12345678-5');
  });

  it('acepta K como dígito verificador sin guion', () => {
    expect(normalizeRut('100686027k')).toBe('100686027-K');
  });

  it('no altera lo que ya viene con guion', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizeRut('100648936-9')).toBe('100648936-9');
  });

  it('deja intacto lo que no parece identificador', () => {
    expect(normalizeRut('abc')).toBe('ABC');
    expect(normalizeRut('')).toBe('');
  });
});
