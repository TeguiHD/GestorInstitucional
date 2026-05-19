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

/** Causales de retiro alineadas con dropdown SIGE (Manual MINEDUC). */
export const WITHDRAWAL_REASONS = {
  CAMBIO_ESTABLECIMIENTO: 'Cambio de establecimiento',
  CAMBIO_DOMICILIO: 'Cambio de domicilio',
  MIGRACION_INTERNACIONAL: 'Cambio de país',
  PROBLEMAS_ECONOMICOS: 'Problemas económicos',
  PROBLEMAS_SALUD: 'Problemas de salud',
  RETIRO_VOLUNTARIO: 'Retiro voluntario',
  FALLECIMIENTO: 'Fallecimiento',
  EXPULSION: 'Cancelación de matrícula (reglamento interno)',
  OTRO: 'Otro motivo',
} as const;

export type WithdrawalReason = keyof typeof WITHDRAWAL_REASONS;
