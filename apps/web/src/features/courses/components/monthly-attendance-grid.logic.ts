export type AttendanceGridStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'JUSTIFIED';

export type AttendanceGridStudent = {
  id: string;
  enrolledAt?: string | null;
  withdrawnAt?: string | null;
};

export type AttendanceGridMatrix = Record<string, Record<string, string>>;
export type AttendanceGridDirty = Map<string, Map<string, AttendanceGridStatus>>;
export type SerializedAttendanceGridDirty = Record<string, Record<string, AttendanceGridStatus>>;

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

function keyPart(value: string): string {
  return encodeURIComponent(value || 'anonymous');
}

export function attendanceDraftStorageKey(
  ownerId: string,
  courseId: string,
  year: number,
  month: number,
): string {
  return `cssp:attendance-draft:${keyPart(ownerId)}:${keyPart(courseId)}:${year}-${String(
    month,
  ).padStart(2, '0')}`;
}

export function serializeAttendanceDirty(
  dirty: AttendanceGridDirty,
): SerializedAttendanceGridDirty {
  return Object.fromEntries(
    Array.from(dirty.entries()).map(([date, studentMap]) => [
      date,
      Object.fromEntries(studentMap.entries()),
    ]),
  );
}

export function deserializeAttendanceDirty(
  raw: unknown,
  opts?: {
    students: AttendanceGridStudent[];
    dates: string[];
    matrix: AttendanceGridMatrix;
    nonSchoolDays?: Record<string, unknown>;
    today?: string;
  },
): AttendanceGridDirty {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();

  const validDates = opts ? new Set(opts.dates) : null;
  const studentsById = opts ? new Map(opts.students.map((student) => [student.id, student])) : null;
  const dirty: AttendanceGridDirty = new Map();

  for (const [date, studentEntries] of Object.entries(raw)) {
    if (validDates && !validDates.has(date)) continue;
    if (opts?.today && date > opts.today) continue;
    if (opts?.nonSchoolDays?.[date]) continue;
    if (!studentEntries || typeof studentEntries !== 'object' || Array.isArray(studentEntries)) {
      continue;
    }

    const dateMap = new Map<string, AttendanceGridStatus>();
    for (const [studentId, status] of Object.entries(studentEntries)) {
      if (typeof status !== 'string') continue;
      if (!isAttendanceGridStatus(status)) continue;

      const student = studentsById?.get(studentId);
      if (opts && (!student || !isStudentActiveOnDate(student, date))) continue;
      if (opts?.matrix[studentId]?.[date] === 'WITHDRAWN') continue;

      dateMap.set(studentId, status);
    }

    if (dateMap.size > 0) dirty.set(date, dateMap);
  }

  return dirty;
}
