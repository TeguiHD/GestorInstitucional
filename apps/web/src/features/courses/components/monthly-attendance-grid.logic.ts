export type AttendanceGridStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'JUSTIFIED';

export type AttendanceGridStudent = {
  id: string;
  enrolledAt?: string | null;
  withdrawnAt?: string | null;
};

export type AttendanceGridMatrix = Record<string, Record<string, string>>;
export type AttendanceGridDirty = Map<string, Map<string, AttendanceGridStatus>>;

export const ATTENDANCE_GRID_STATUS_CYCLE: AttendanceGridStatus[] = [
  'PRESENT',
  'ABSENT',
  'LATE',
  'JUSTIFIED',
];

export function isAttendanceGridStatus(value: string | undefined): value is AttendanceGridStatus {
  return ATTENDANCE_GRID_STATUS_CYCLE.includes(value as AttendanceGridStatus);
}

function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

export function isStudentActiveOnDate(student: AttendanceGridStudent, date: string): boolean {
  const enrolledAt = dateOnly(student.enrolledAt);
  if (enrolledAt && enrolledAt > date) return false;

  const withdrawnAt = dateOnly(student.withdrawnAt);
  if (withdrawnAt && withdrawnAt <= date) return false;

  return true;
}

export function getActiveStudentIdsForDate(
  students: AttendanceGridStudent[],
  date: string,
  matrix: AttendanceGridMatrix,
): string[] {
  return students
    .filter((student) => isStudentActiveOnDate(student, date))
    .filter((student) => matrix[student.id]?.[date] !== 'WITHDRAWN')
    .map((student) => student.id);
}

export function buildPresentStatusMap(
  students: AttendanceGridStudent[],
  date: string,
  matrix: AttendanceGridMatrix,
): Map<string, AttendanceGridStatus> {
  return new Map(
    getActiveStudentIdsForDate(students, date, matrix).map((studentId) => [
      studentId,
      'PRESENT' as const,
    ]),
  );
}

export function getNextAttendanceStatus(currentStatus: string | undefined): AttendanceGridStatus {
  if (!isAttendanceGridStatus(currentStatus)) return 'PRESENT';
  const currentIdx = ATTENDANCE_GRID_STATUS_CYCLE.indexOf(currentStatus);
  return ATTENDANCE_GRID_STATUS_CYCLE[(currentIdx + 1) % ATTENDANCE_GRID_STATUS_CYCLE.length]!;
}

export function getDateCompletion(
  students: AttendanceGridStudent[],
  date: string,
  matrix: AttendanceGridMatrix,
  dirty: AttendanceGridDirty = new Map(),
) {
  const activeStudentIds = getActiveStudentIdsForDate(students, date, matrix);
  const dirtyForDate = dirty.get(date);
  const missingStudentIds = activeStudentIds.filter((studentId) => {
    const status = dirtyForDate?.get(studentId) ?? matrix[studentId]?.[date];
    return !isAttendanceGridStatus(status);
  });
  const recordedStudentIds = activeStudentIds.filter((studentId) => {
    const status = dirtyForDate?.get(studentId) ?? matrix[studentId]?.[date];
    return isAttendanceGridStatus(status);
  });

  return {
    activeCount: activeStudentIds.length,
    missingCount: missingStudentIds.length,
    missingStudentIds,
    isComplete: missingStudentIds.length === 0,
    isEmpty: recordedStudentIds.length === 0,
    isPartial: recordedStudentIds.length > 0 && missingStudentIds.length > 0,
  };
}
