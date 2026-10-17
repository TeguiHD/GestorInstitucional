export type ReviewableAttendanceStatus = 'ABSENT' | 'LATE' | 'JUSTIFIED';

/**
 * Fórmula V2 (`PRESENT_OVER_CLASSES_EXCL_PENDING_LATE_V2`): un atraso pendiente
 * (status LATE) no cuenta como asistencia ni como inasistencia; se excluye del
 * numerador y del denominador. Ver
 * docs/superpowers/specs/2026-10-17-atrasos-pendientes-design.md.
 */
export const ATTENDANCE_FORMULA_VERSION = 'PRESENT_OVER_CLASSES_EXCL_PENDING_LATE_V2';

export type AttendanceStatsLike = {
  total?: number | null;
  present?: number | null;
  late?: number | null;
  pendingLate?: number | null;
  attended?: number | null;
  totalClasses?: number | null;
};

export type AttendanceMatrixLike = {
  dates: string[];
  matrix: Record<string, Record<string, string | undefined> | undefined>;
  /** Fechas con marca de atraso por alumno (pendientes y resueltos). */
  lateMarks?: Record<string, string[] | undefined>;
};

/** Días que cuentan como asistencia: solo PRESENT. */
export function attendedDays(stats: AttendanceStatsLike): number {
  return stats.attended ?? stats.present ?? 0;
}

export function totalClasses(stats: AttendanceStatsLike): number {
  return stats.totalClasses ?? stats.total ?? 0;
}

export function pendingLateDays(stats: AttendanceStatsLike): number {
  return stats.pendingLate ?? 0;
}

/** Denominador del %: clases − atrasos pendientes. */
export function effectiveClasses(stats: AttendanceStatsLike): number {
  return Math.max(0, totalClasses(stats) - pendingLateDays(stats));
}

export function manualFormulaText(stats: AttendanceStatsLike): string {
  const pending = pendingLateDays(stats);
  const denominator =
    pending > 0 ? `(${totalClasses(stats)} − ${pending})` : String(totalClasses(stats));
  return `${attendedDays(stats)} * 100 / ${denominator}`;
}

export function attendancePercent(stats: AttendanceStatsLike): number | null {
  const denominator = effectiveClasses(stats);
  return denominator > 0 ? attendedDays(stats) / denominator : null;
}

/**
 * Fechas de un alumno con cierto estado. Para `LATE` incluye también los atrasos
 * ya resueltos (marca de atraso), igual que el conteo `late` del backend.
 */
export function statusDatesForStudent(
  matrices: AttendanceMatrixLike[],
  studentId: string,
  status: ReviewableAttendanceStatus,
): string[] {
  const dates = new Set<string>();
  for (const matrix of matrices) {
    const marks = status === 'LATE' ? new Set(matrix.lateMarks?.[studentId] ?? []) : null;
    for (const date of matrix.dates) {
      if (matrix.matrix[studentId]?.[date] === status || marks?.has(date)) dates.add(date);
    }
  }
  return Array.from(dates).sort();
}
