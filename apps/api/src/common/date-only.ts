import { BadRequestException } from '@nestjs/common';

function assertCalendarDate(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException('Fecha inválida');
  }
  return date;
}

export function parseDateOnlyUtc(value?: string): Date {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    return assertCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const cl = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (cl) {
    return assertCalendarDate(Number(cl[3]), Number(cl[2]), Number(cl[1]));
  }

  throw new BadRequestException('Fecha inválida');
}

function keyFromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

function keyFromLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function formatDateOnlyKey(date: Date): string {
  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (isUtcMidnight) return keyFromUtc(date);

  // Compatibility guard for date-only values accidentally persisted as the
  // previous UTC evening after Chile timezone conversion.
  if (
    date.getUTCHours() >= 18 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return keyFromUtc(addUtcDays(date, 1));
  }

  return keyFromLocal(date);
}

export function dateOnlyCandidateKeys(date: Date): string[] {
  const keys = new Set<string>([formatDateOnlyKey(date), keyFromUtc(date), keyFromLocal(date)]);
  if (date.getUTCHours() >= 18) keys.add(keyFromUtc(addUtcDays(date, 1)));
  if (date.getUTCHours() <= 5) keys.add(keyFromUtc(addUtcDays(date, -1)));
  return Array.from(keys);
}

export function expandDateOnlyRange(from: Date, to: Date): { from: Date; to: Date } {
  const expandedFrom = new Date(from);
  expandedFrom.setUTCDate(expandedFrom.getUTCDate() - 1);
  expandedFrom.setUTCHours(0, 0, 0, 0);

  const expandedTo = new Date(to);
  expandedTo.setUTCDate(expandedTo.getUTCDate() + 1);
  expandedTo.setUTCHours(23, 59, 59, 999);

  return { from: expandedFrom, to: expandedTo };
}
