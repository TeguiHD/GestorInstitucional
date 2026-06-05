import { AttendanceStatus } from '@prisma/client';

export const ATTENDANCE_FORMULA_VERSION = 'PRESENT_LATE_OVER_TOTAL_CLASSES_V1';

export type AttendanceCounts = {
  present: number;
  late: number;
  absent: number;
  justified: number;
};

export type AttendanceSummary = AttendanceCounts & {
  totalClasses: number;
  missing: number;
  attended: number;
  attendanceRate: number | null;
  formulaVersion: typeof ATTENDANCE_FORMULA_VERSION;
};

export function countsAsAttendance(status: AttendanceStatus | string | null | undefined): boolean {
  return status === AttendanceStatus.PRESENT || status === AttendanceStatus.LATE;
}

export function emptyAttendanceCounts(): AttendanceCounts {
  return { present: 0, late: 0, absent: 0, justified: 0 };
}

export function addAttendanceStatus(
  counts: AttendanceCounts,
  status: AttendanceStatus | string | null | undefined,
): void {
  if (status === AttendanceStatus.PRESENT) counts.present++;
  else if (status === AttendanceStatus.LATE) counts.late++;
  else if (status === AttendanceStatus.ABSENT) counts.absent++;
  else if (status === AttendanceStatus.JUSTIFIED) counts.justified++;
}

export function buildAttendanceSummary(
  counts: AttendanceCounts,
  totalClasses: number,
): AttendanceSummary {
  const recorded = counts.present + counts.late + counts.absent + counts.justified;
  const attended = counts.present + counts.late;
  return {
    ...counts,
    totalClasses,
    missing: Math.max(0, totalClasses - recorded),
    attended,
    attendanceRate: totalClasses > 0 ? attended / totalClasses : null,
    formulaVersion: ATTENDANCE_FORMULA_VERSION,
  };
}
