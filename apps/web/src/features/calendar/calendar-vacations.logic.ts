export type AcademicYearConfig = {
  firstSemester: { startDate: string; endDate: string };
  secondSemester: { startDate: string; endDate: string };
};

export type VacationKind = 'winter' | 'summer';
export type VacationInfo = { kind: VacationKind; label: string };
export type VacationBanner = {
  kind: VacationKind;
  label: string;
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  returnDate: string | null; // primer día de clases tras la franja (null si no hay)
};

const LABELS: Record<VacationKind, string> = {
  winter: 'Vacaciones de invierno',
  summer: 'Vacaciones de verano',
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// La config viene de la API: si por cualquier razón llega incompleta,
// preferimos "sin vacaciones visibles" antes que celdas mal pintadas.
function isValidConfig(config: AcademicYearConfig | undefined): config is AcademicYearConfig {
  const keys = [
    config?.firstSemester?.startDate,
    config?.firstSemester?.endDate,
    config?.secondSemester?.startDate,
    config?.secondSemester?.endDate,
  ];
  return keys.every((k) => typeof k === 'string' && DATE_KEY_RE.test(k));
}

/** Suma/resta días a una fecha YYYY-MM-DD vía Date.UTC — sin timezone local. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/**
 * Vacaciones derivadas de la config de semestres. Mismas comparaciones
 * lexicográficas que el backend (calendar.service.ts:getOutOfPeriodDays):
 * invierno = estrictamente entre semestres; verano = fuera del año escolar.
 */
export function getVacationInfo(
  dateKey: string,
  config: AcademicYearConfig | undefined,
): VacationInfo | null {
  if (!isValidConfig(config)) return null;
  if (dateKey < config.firstSemester.startDate || dateKey > config.secondSemester.endDate) {
    return { kind: 'summer', label: LABELS.summer };
  }
  if (dateKey > config.firstSemester.endDate && dateKey < config.secondSemester.startDate) {
    return { kind: 'winter', label: LABELS.winter };
  }
  return null;
}

/** true si la fecha YYYY-MM-DD cae sábado o domingo (UTC, sin TZ local). */
export function isWeekendKey(dateKey: string): boolean {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

function rangeContainsWeekday(from: string, to: string): boolean {
  for (let key = from; key <= to; key = shiftDateKey(key, 1)) {
    if (!isWeekendKey(key)) return true;
  }
  return false;
}

/** Franjas informativas del año calendario, para las cards bajo la grilla. */
export function getVacationBanners(
  year: number,
  config: AcademicYearConfig | undefined,
): VacationBanner[] {
  if (!isValidConfig(config)) return [];
  const banners: VacationBanner[] = [];
  const jan1 = `${year}-01-01`;
  const dec31 = `${year}-12-31`;

  if (config.firstSemester.startDate > jan1) {
    banners.push({
      kind: 'summer',
      label: LABELS.summer,
      from: jan1,
      to: shiftDateKey(config.firstSemester.startDate, -1),
      returnDate: config.firstSemester.startDate,
    });
  }

  const winterFrom = shiftDateKey(config.firstSemester.endDate, 1);
  const winterTo = shiftDateKey(config.secondSemester.startDate, -1);
  if (winterFrom <= winterTo) {
    banners.push({
      kind: 'winter',
      label: LABELS.winter,
      from: winterFrom,
      to: winterTo,
      returnDate: config.secondSemester.startDate,
    });
  }

  if (config.secondSemester.endDate < dec31) {
    banners.push({
      kind: 'summer',
      label: LABELS.summer,
      from: shiftDateKey(config.secondSemester.endDate, 1),
      to: dec31,
      returnDate: null,
    });
  }

  // Una "franja" sin días hábiles (ej: hueco entre semestres que cae en
  // fin de semana) no es información útil — se omite.
  return banners.filter((b) => rangeContainsWeekday(b.from, b.to));
}
