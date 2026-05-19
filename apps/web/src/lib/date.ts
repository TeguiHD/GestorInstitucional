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

export function fmtDayName(
  input: string | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = parseDayLocal(input);
  if (!d) return '—';
  return d.toLocaleDateString('es-CL', opts ?? { weekday: 'long' });
}
