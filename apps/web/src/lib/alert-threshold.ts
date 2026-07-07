export type AlertTriggerId =
  | 'STUDENT_BELOW_THRESHOLD'
  | 'COURSE_BELOW_THRESHOLD'
  | 'STUDENT_CONSECUTIVE_ABSENCES'
  | 'TEACHER_NO_RECORD';

/** Valor inicial del campo umbral según el tipo de regla. */
export const TRIGGER_DEFAULT_THRESHOLD: Record<AlertTriggerId, string> = {
  STUDENT_BELOW_THRESHOLD: '85',
  COURSE_BELOW_THRESHOLD: '85',
  STUDENT_CONSECUTIVE_ABSENCES: '3',
  TEACHER_NO_RECORD: '2',
};

/**
 * Convierte el valor del input al payload que espera la API:
 * - Triggers de porcentaje viajan como fracción (85 → 0.85).
 * - Triggers de conteo de días viajan como entero >= 1 (3 → 3).
 *   (El bug histórico dividía TODO por 100: "3 días" se guardaba 0.03 y la
 *   regla de ausencias consecutivas disparaba con una sola ausencia.)
 */
export function thresholdPayload(trigger: AlertTriggerId, raw: string): number | undefined {
  const value = parseFloat(raw);
  if (isNaN(value)) return undefined;
  if (trigger === 'STUDENT_BELOW_THRESHOLD' || trigger === 'COURSE_BELOW_THRESHOLD') {
    return value / 100;
  }
  return Math.max(1, Math.round(value));
}
