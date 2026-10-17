/**
 * Retención de respaldos por niveles (abuelo-padre-hijo).
 *
 * Cada respaldo es un volcado COMPLETO de la base (más uploads): restaurar es
 * cargar un solo archivo. Por eso no se usan incrementales — complicarían
 * justo el caso de emergencia — y lo que se acota es cuántas copias completas
 * se guardan:
 *
 * - todos los de los últimos 14 días (incluye varios por día);
 * - el último de cada una de las 8 semanas más recientes;
 * - el último de cada uno de los 24 meses más recientes;
 * - el último de cada año, para siempre.
 *
 * No se pierde historia: cada cambio de asistencia queda en la auditoría
 * (encadenada por hash) que viaja dentro de cada respaldo, así que el más
 * reciente ya contiene el historial completo. Las copias antiguas sirven para
 * volver a un estado anterior si hiciera falta.
 */

export const BACKUP_RETENTION = { dailyDays: 14, weeks: 8, months: 24 } as const;

/** Mínimo de respaldos reconocidos para que la purga actúe. */
const MIN_BACKUPS_BEFORE_PURGE = BACKUP_RETENTION.dailyDays + 1;

export type RetentionTier = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'protected';

const NAME_RE = /^backup_asistencia_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.(zip|7z|sql)$/;

type Parsed = { name: string; at: Date; day: string; week: string; month: string; year: string };

function parse(name: string): Parsed | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const at = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
  if (Number.isNaN(at.getTime())) return null;
  return { name, at, day: `${y}-${mo}-${d}`, week: isoWeek(at), month: `${y}-${mo}`, year: y! };
}

/** Semana ISO 8601 (`2026-W42`), en UTC. */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** El más nuevo de cada grupo, para los `limit` grupos más recientes. */
function newestPerGroup(sortedDesc: Parsed[], key: (p: Parsed) => string, limit: number) {
  const picked: Parsed[] = [];
  const seen = new Set<string>();
  for (const p of sortedDesc) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(p);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * Decide qué respaldos conservar. Los nombres que no siguen el formato
 * `backup_asistencia_YYYY-MM-DD_HHMMSS.ext` no se tocan nunca.
 */
export function planBackupRetention(
  fileNames: string[],
  opts: { now?: Date; protect?: Set<string> } = {},
): { keep: Map<string, RetentionTier>; remove: string[] } {
  const now = opts.now ?? new Date();
  const parsed = fileNames
    .map(parse)
    .filter((p): p is Parsed => p !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const keep = new Map<string, RetentionTier>();
  const mark = (p: Parsed, tier: RetentionTier) => {
    if (!keep.has(p.name)) keep.set(p.name, tier);
  };

  for (const p of parsed) if (opts.protect?.has(p.name)) mark(p, 'protected');

  const dailyCutoff = now.getTime() - BACKUP_RETENTION.dailyDays * 86_400_000;
  for (const p of parsed) if (p.at.getTime() >= dailyCutoff) mark(p, 'daily');
  // Con el reloj atrasado o sin respaldos recientes, el más nuevo igual se queda.
  if (parsed[0]) mark(parsed[0], 'daily');

  for (const p of newestPerGroup(parsed, (x) => x.week, BACKUP_RETENTION.weeks)) mark(p, 'weekly');
  for (const p of newestPerGroup(parsed, (x) => x.month, BACKUP_RETENTION.months))
    mark(p, 'monthly');
  for (const p of newestPerGroup(parsed, (x) => x.year, Number.POSITIVE_INFINITY))
    mark(p, 'yearly');

  if (parsed.length < MIN_BACKUPS_BEFORE_PURGE) {
    for (const p of parsed) mark(p, 'daily');
    return { keep, remove: [] };
  }

  return { keep, remove: parsed.filter((p) => !keep.has(p.name)).map((p) => p.name) };
}
