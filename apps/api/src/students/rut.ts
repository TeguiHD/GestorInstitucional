export function normalizeRut(value: string): string {
  return value.replace(/\./g, '').replace(/\s/g, '').toUpperCase();
}

export function isValidRut(value: string): boolean {
  const rut = normalizeRut(value);
  const match = /^(\d{7,8})-([\dK])$/.exec(rut);
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
