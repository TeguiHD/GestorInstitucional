import { isWeekendKey, shiftDateKey } from './calendar-vacations.logic';

export type RangePlan =
  | { ok: true; create: string[]; skippedExisting: string[]; skippedWeekends: number }
  | { ok: false; error: 'INVALID_RANGE' | 'RANGE_TOO_LARGE' };

export const RANGE_MAX_DAYS = 60;

/**
 * Expande un rango [from, to] (YYYY-MM-DD, mismo año) a los días a crear como
 * día especial: hábiles y sin entrada previa. Nunca sobreescribe existentes.
 */
export function buildRangeDayKeys(
  from: string,
  to: string,
  existing: ReadonlySet<string>,
): RangePlan {
  // El mapa de existentes se construye por año visible: un rango que cruza
  // de año no puede validarse contra él.
  if (to < from || from.slice(0, 4) !== to.slice(0, 4)) {
    return { ok: false, error: 'INVALID_RANGE' };
  }

  const create: string[] = [];
  const skippedExisting: string[] = [];
  let skippedWeekends = 0;
  let days = 0;

  for (let key = from; key <= to; key = shiftDateKey(key, 1)) {
    days += 1;
    if (days > RANGE_MAX_DAYS) return { ok: false, error: 'RANGE_TOO_LARGE' };
    if (isWeekendKey(key)) {
      skippedWeekends += 1;
    } else if (existing.has(key)) {
      skippedExisting.push(key);
    } else {
      create.push(key);
    }
  }

  return { ok: true, create, skippedExisting, skippedWeekends };
}
