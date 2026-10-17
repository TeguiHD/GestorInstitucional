import { AttendanceStatus } from '@prisma/client';

/**
 * V2 (2026-10-17): un atraso pendiente (status LATE) no cuenta como asistencia ni
 * como inasistencia hasta que Inspectoría lo resuelva; se excluye del numerador y
 * del denominador. Ver docs/superpowers/specs/2026-10-17-atrasos-pendientes-design.md.
 */
export const ATTENDANCE_FORMULA_VERSION = 'PRESENT_OVER_CLASSES_EXCL_PENDING_LATE_V2';

export type AttendanceCounts = {
  present: number;
  absent: number;
  justified: number;
  /** Atrasos del período: registros con marca de atraso (pendientes + resueltos). */
  late: number;
  /** Atrasos aún sin resolver (status LATE): fuera del cálculo del %. */
  pendingLate: number;
};

export type AttendanceSummary = AttendanceCounts & {
  totalClasses: number;
  /** totalClasses − pendingLate: denominador del %. */
  effectiveClasses: number;
  missing: number;
  attended: number;
  attendanceRate: number | null;
  formulaVersion: typeof ATTENDANCE_FORMULA_VERSION;
};

export function countsAsAttendance(status: AttendanceStatus | string | null | undefined): boolean {
  return status === AttendanceStatus.PRESENT;
}

/** Atraso aún sin resolver por Inspectoría. */
export function isPendingLate(status: AttendanceStatus | string | null | undefined): boolean {
  return status === AttendanceStatus.LATE;
}

/** Inasistencia (justificada o no). Un atraso pendiente no lo es: el alumno llegó. */
export function countsAsAbsence(status: AttendanceStatus | string | null | undefined): boolean {
  return status === AttendanceStatus.ABSENT || status === AttendanceStatus.JUSTIFIED;
}

export function emptyAttendanceCounts(): AttendanceCounts {
  return { present: 0, absent: 0, justified: 0, late: 0, pendingLate: 0 };
}

export function addAttendanceStatus(
  counts: AttendanceCounts,
  status: AttendanceStatus | string | null | undefined,
  wasLate = false,
): void {
  if (status === AttendanceStatus.PRESENT) counts.present++;
  else if (status === AttendanceStatus.ABSENT) counts.absent++;
  else if (status === AttendanceStatus.JUSTIFIED) counts.justified++;
  else if (status === AttendanceStatus.LATE) counts.pendingLate++;
  else return;
  if (wasLate || status === AttendanceStatus.LATE) counts.late++;
}

export function buildAttendanceSummary(
  counts: AttendanceCounts,
  totalClasses: number,
): AttendanceSummary {
  const effectiveClasses = Math.max(0, totalClasses - counts.pendingLate);
  const recorded = counts.present + counts.absent + counts.justified;
  return {
    ...counts,
    totalClasses,
    effectiveClasses,
    missing: Math.max(0, effectiveClasses - recorded),
    attended: counts.present,
    attendanceRate: effectiveClasses > 0 ? counts.present / effectiveClasses : null,
    formulaVersion: ATTENDANCE_FORMULA_VERSION,
  };
}

/**
 * Marca de atraso tras guardar un registro desde la grilla.
 *
 * - Guardar LATE siempre marca el atraso.
 * - Cambiar un atraso pendiente a otro estado es una resolución si lo hace
 *   Inspectoría (se conserva la marca) o una corrección de captura si lo hace un
 *   profesor que marcó mal (se quita).
 * - Un atraso ya resuelto conserva su marca aunque cambie el estado final.
 */
export function nextWasLate(
  existing: { status: AttendanceStatus | string; wasLate: boolean } | undefined,
  newStatus: AttendanceStatus | string,
  resolvesLate: boolean,
): boolean {
  if (newStatus === AttendanceStatus.LATE) return true;
  if (!existing) return false;
  if (existing.status === AttendanceStatus.LATE) return resolvesLate;
  return existing.wasLate;
}

/**
 * Estado del registro al aprobar una justificación. Un atraso justificado (por
 * ejemplo, llegó tarde por una hora médica) queda presente; una inasistencia
 * justificada queda JUSTIFIED.
 */
export function statusAfterJustification(record: {
  status: AttendanceStatus | string;
  wasLate: boolean;
}): 'PRESENT' | 'JUSTIFIED' {
  return record.status === AttendanceStatus.LATE || record.wasLate ? 'PRESENT' : 'JUSTIFIED';
}
