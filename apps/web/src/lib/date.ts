/**
 * Parse a date-like input (ISO datetime, YYYY-MM-DD, or Date) to a local Date
 * anchored at noon (avoids timezone day-flip).
 *
 * The backend returns full ISO datetimes (e.g. "2026-05-04T00:00:00.000Z").
 * Concatenating `'T12:00'` to that breaks the parse — slice to date-only first.
 */
export function parseDayLocal(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const dateOnly = input.slice(0, 10);
  const d = new Date(`${dateOnly}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateInputValue(input: string | Date | null | undefined): string {
  if (!input) return '';
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return '';
    return input.toISOString().slice(0, 10);
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(input);
  if (iso) return iso[1]!;
  const cl = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (cl) return `${cl[3]}-${cl[2]}-${cl[1]}`;
  return '';
}

export function fmtDateCl(input: string | Date | null | undefined): string {
  const value = dateInputValue(input);
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function fmtDayName(
  input: string | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = parseDayLocal(input);
  if (!d) return '—';
  return d.toLocaleDateString('es-CL', opts ?? { weekday: 'long' });
}
