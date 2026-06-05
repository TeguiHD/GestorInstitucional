export type ReviewableAttendanceStatus = 'ABSENT' | 'LATE' | 'JUSTIFIED';

export type AttendanceStatsLike = {
  total?: number | null;
  present?: number | null;
  late?: number | null;
  attended?: number | null;
  totalClasses?: number | null;
};

export type AttendanceMatrixLike = {
  dates: string[];
  matrix: Record<string, Record<string, string | undefined> | undefined>;
};

export function attendedDays(stats: AttendanceStatsLike): number {
  return stats.attended ?? (stats.present ?? 0) + (stats.late ?? 0);
}

export function totalClasses(stats: AttendanceStatsLike): number {
  return stats.totalClasses ?? stats.total ?? 0;
}

export function manualFormulaText(stats: AttendanceStatsLike): string {
  return `${attendedDays(stats)} * 100 / ${totalClasses(stats)}`;
}

export function attendancePercent(stats: AttendanceStatsLike): number | null {
  const denominator = totalClasses(stats);
  return denominator > 0 ? attendedDays(stats) / denominator : null;
}

export function statusDatesForStudent(
  matrices: AttendanceMatrixLike[],
  studentId: string,
  status: ReviewableAttendanceStatus,
): string[] {
  const dates = new Set<string>();
  for (const matrix of matrices) {
    for (const date of matrix.dates) {
      if (matrix.matrix[studentId]?.[date] === status) dates.add(date);
    }
  }
  return Array.from(dates).sort();
}
