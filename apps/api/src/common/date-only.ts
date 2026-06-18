import { BadRequestException } from '@nestjs/common';

/**
 * Capa date-only canonica.
 *
 * Las fechas de asistencia/calendario viven en columnas MariaDB `@db.Date`
 * (sin hora, sin zona). El ancla canonica es **medianoche UTC** del dia
 * calendario: `parseDateOnlyUtc('2026-06-16')` -> `2026-06-16T00:00:00.000Z`.
 *
 * Reglas:
 *  - Para LEER la clave de un valor almacenado usar `formatDateOnlyKey`
 *    (siempre UTC, deterministica, independiente de la TZ del proceso).
 *  - Para saber "que dia es hoy en Chile" usar `chileTodayKey` / `dateKeyInTz`,
 *    que NO dependen de `process.env.TZ`.
 *
 * No se usan heuristicas de "recuperacion" (+1/-1) en runtime: los valores
 * historicos corridos se corrigen una sola vez por migracion de datos.
 */

export const CHILE_TZ = 'America/Santiago';

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

/**
 * Clave `YYYY-MM-DD` de un valor date-only almacenado.
 *
 * Un `@db.Date` se materializa anclado a medianoche (UTC o local segun el
 * motor), nunca a una hora de tarde, por lo que tomar la fecha en UTC siempre
 * devuelve el dia calendario correcto sin importar la TZ del proceso.
 */
export function formatDateOnlyKey(date: Date): string {
  return keyFromUtc(date);
}

/** Dia calendario `YYYY-MM-DD` de un instante en una zona horaria dada. */
export function dateKeyInTz(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hoy en hora de Chile, independiente de `process.env.TZ`. */
export function chileTodayKey(now: Date = new Date()): string {
  return dateKeyInTz(now, CHILE_TZ);
}

/** Medianoche UTC del dia de hoy en Chile (para comparaciones contra @db.Date). */
export function chileTodayUtc(now: Date = new Date()): Date {
  return parseDateOnlyUtc(chileTodayKey(now));
}

/**
 * Fin del dia de hoy en Chile, anclado en terminos UTC (`23:59:59.999Z` del
 * dia chileno). Sirve como cota superior inclusiva al comparar contra valores
 * `@db.Date` (que vienen a medianoche UTC), separando hoy de mañana sin
 * depender de `process.env.TZ`.
 */
export function chileTodayEndUtc(now: Date = new Date()): Date {
  return new Date(chileTodayUtc(now).getTime() + 86_400_000 - 1);
}

/**
 * Ventana UTC inclusiva que cubre con holgura un rango de dias date-only,
 * para acotar consultas Prisma. El filtrado exacto se hace luego comparando
 * `formatDateOnlyKey(record.date)`.
 */
export function expandDateOnlyRange(from: Date, to: Date): { from: Date; to: Date } {
  const expandedFrom = new Date(from);
  expandedFrom.setUTCDate(expandedFrom.getUTCDate() - 1);
  expandedFrom.setUTCHours(0, 0, 0, 0);

  const expandedTo = new Date(to);
  expandedTo.setUTCDate(expandedTo.getUTCDate() + 1);
  expandedTo.setUTCHours(23, 59, 59, 999);

  return { from: expandedFrom, to: expandedTo };
}
