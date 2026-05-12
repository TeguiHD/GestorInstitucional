export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DIRECTOR: 'DIRECTOR',
  UTP: 'UTP',
  INSPECTORIA: 'INSPECTORIA',
  PROFESOR: 'PROFESOR',
  APODERADO: 'APODERADO',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLES_REQUIRING_2FA: readonly Role[] = [ROLES.SUPER_ADMIN] as const;

export const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  LATE: 'LATE',
  JUSTIFIED: 'JUSTIFIED',
  WITHDRAWN: 'WITHDRAWN',
} as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

/** Umbrales de asistencia (banderas visuales). */
export const ATTENDANCE_THRESHOLDS = {
  GOOD: 0.9,
  WARN: 0.7,
} as const;

export const API_PREFIX = '/api/v1';
