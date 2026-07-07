import { describe, expect, it } from 'vitest';

import { thresholdPayload } from './alert-threshold';

describe('thresholdPayload', () => {
  it('convierte porcentajes a fracción', () => {
    expect(thresholdPayload('STUDENT_BELOW_THRESHOLD', '85')).toBe(0.85);
    expect(thresholdPayload('COURSE_BELOW_THRESHOLD', '70')).toBe(0.7);
  });

  it('los triggers de días viajan como entero, NO divididos por 100', () => {
    expect(thresholdPayload('STUDENT_CONSECUTIVE_ABSENCES', '3')).toBe(3);
    expect(thresholdPayload('TEACHER_NO_RECORD', '2')).toBe(2);
  });

  it('normaliza valores raros de días a entero >= 1', () => {
    expect(thresholdPayload('TEACHER_NO_RECORD', '0')).toBe(1);
    expect(thresholdPayload('STUDENT_CONSECUTIVE_ABSENCES', '2.6')).toBe(3);
  });

  it('devuelve undefined si el input no es numérico', () => {
    expect(thresholdPayload('STUDENT_BELOW_THRESHOLD', '')).toBeUndefined();
  });
});
