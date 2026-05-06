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
