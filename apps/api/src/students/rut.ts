export function normalizeRut(value: string): string {
  const compact = value.replace(/\./g, '').replace(/\s/g, '').toUpperCase();
  if (compact.includes('-')) return compact;
  // Las planillas del colegio traen el identificador de corrido. El último
  // carácter es siempre el dígito verificador.
  if (!/^\d{6,9}[\dK]$/.test(compact)) return compact;
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}

export function isValidRut(value: string): boolean {
  const rut = normalizeRut(value);
  // 7-8 dígitos: RUT chileno. 9 dígitos: IPE (Identificador Provisorio Escolar)
  // que MINEDUC asigna a alumnos migrantes sin RUT. Mismo DV módulo 11.
  const match = /^(\d{7,9})-([\dK])$/.exec(rut);
  if (!match) return false;

  const body = match[1]!;
  const expectedDv = match[2]!;
  let multiplier = 2;
  let sum = 0;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  const calculatedDv = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return calculatedDv === expectedDv;
}
