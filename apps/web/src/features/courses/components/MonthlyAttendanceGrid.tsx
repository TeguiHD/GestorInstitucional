import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Save,
  Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { attendanceQueue } from '@/lib/attendance-queue';
import { useAttendanceSync } from '@/hooks/useAttendanceSync';
import { cn } from '@/lib/cn';
import {
  buildPresentStatusMap,
  getDateCompletion,
  getNextAttendanceStatus,
  isAttendanceGridStatus,
  isStudentActiveOnDate,
  type AttendanceGridStatus,
} from './monthly-attendance-grid.logic';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type StatusKey = AttendanceGridStatus;

type StudentStat = {
  id: string;
  firstName: string;
  lastName: string;
  enrollmentNumber: number;
  enrolledAt?: string;
  withdrawnAt?: string | null;
  total: number;
  present: number;
  absent: number;
  justified: number;
  rate: number | null;
};

type NonSchoolDay = { type: string; description: string };

type MatrixData = {
  students: StudentStat[];
  dates: string[];
  matrix: Record<string, Record<string, string>>;
  nonSchoolDays: Record<string, NonSchoolDay>;
  schoolDays: string[];
  today: string;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_SHORT: Record<string, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  LATE: 'AT',
  JUSTIFIED: 'J',
  WITHDRAWN: 'R',
};

const STATUS_CELL_CLASS: Record<string, string> = {
  PRESENT: 'att-cell--present',
  ABSENT: 'att-cell--absent',
  LATE: 'att-cell--late',
  JUSTIFIED: 'att-cell--justified',
  WITHDRAWN: 'att-cell--withdrawn',
};

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const DOW_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function rateBadge(r: number | null): string {
  if (r == null) return 'att-rate--none';
  if (r >= 0.9) return 'att-rate--good';
  if (r >= 0.7) return 'att-rate--warn';
  return 'att-rate--bad';
}

function formatGridDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
  });
}

class IncompleteAttendanceError extends Error {}

type PendingConfirm = {
  date: string;
  studentId: string;
  next: StatusKey;
  fillPresentFirst: boolean;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MonthlyAttendanceGrid({ courseId }: { courseId: string }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  // dirty = user modifications: date -> studentId -> status
  const [dirty, setDirty] = useState<Map<string, Map<string, StatusKey>>>(new Map());
  // past days user has confirmed editing
  const [unlockedDays, setUnlockedDays] = useState<Set<string>>(new Set());
  // pending confirmation
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const todayColRef = useRef<HTMLTableHeaderCellElement>(null);
  const qc = useQueryClient();
  const { online, pendingCount, refreshCount } = useAttendanceSync();

  const { data: matrix, isLoading } = useQuery<MatrixData>({
    queryKey: ['course-matrix', courseId, year, month],
    queryFn: () => api.get(`/attendance/course/${courseId}/matrix?year=${year}&month=${month}`),
  });

  const students = matrix?.students ?? [];
  const dates = matrix?.dates ?? [];
  const todayKey = matrix?.today ?? '';

  // Pre-mark today as all present if no records exist for today
  useEffect(() => {
    if (!matrix) return;
    const todayKey = matrix.today;
    // Only for current month view
    if (!matrix.dates.includes(todayKey)) return;
    // Only if today is a school day
    if (!matrix.schoolDays.includes(todayKey)) return;
    // Only if user hasn't already dirtied today
    if (dirty.has(todayKey)) return;

    const completion = getDateCompletion(matrix.students, todayKey, matrix.matrix);
    if (!completion.isEmpty) return;

    const todayMap = buildPresentStatusMap(matrix.students, todayKey, matrix.matrix);
    if (todayMap.size > 0) {
      setDirty((prev) => {
        const next = new Map(prev);
        next.set(todayKey, todayMap);
        return next;
      });
    }
  }, [dirty, matrix]);

  // Scroll to today column on load
  useEffect(() => {
    if (todayColRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const col = todayColRef.current;
      const offset =
        col.offsetLeft - container.offsetLeft - container.clientWidth / 2 + col.clientWidth / 2;
      container.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
    }
  }, [matrix]);

  // Reset dirty when month changes
  useEffect(() => {
    setDirty(new Map());
    setUnlockedDays(new Set());
    setPendingConfirm(null);
  }, [year, month]);

  const dirtyCount = useMemo(() => {
    let count = 0;
    dirty.forEach((m) => (count += m.size));
    return count;
  }, [dirty]);

  const dayCompletion = useMemo(() => {
    const byDate = new Map<string, ReturnType<typeof getDateCompletion>>();
    if (!matrix) return byDate;

    for (const date of dates) {
      byDate.set(date, getDateCompletion(students, date, matrix.matrix, dirty));
    }
    return byDate;
  }, [dates, dirty, matrix, students]);

  const incompleteDirtyDates = useMemo(
    () =>
      Array.from(dirty.keys()).filter((date) => {
        const completion = dayCompletion.get(date);
        return completion ? completion.missingCount > 0 : false;
      }),
    [dayCompletion, dirty],
  );

  const getEffectiveStatus = useCallback(
    (studentId: string, date: string): string | undefined => {
      const dirtyStatus = dirty.get(date)?.get(studentId);
      if (dirtyStatus) return dirtyStatus;
      return matrix?.matrix[studentId]?.[date];
    },
    [dirty, matrix],
  );

  const isDirtyCell = useCallback(
    (studentId: string, date: string): boolean => {
      return dirty.get(date)?.has(studentId) ?? false;
    },
    [dirty],
  );

  const handleCellClick = useCallback(
    (studentId: string, date: string) => {
      if (!matrix) return;

      const todayKey = matrix.today;
      // Block future days
      if (date > todayKey) return;
      // Block holidays
      if (matrix.nonSchoolDays[date]) return;
      const student = matrix.students.find((s) => s.id === studentId);
      if (!student || !isStudentActiveOnDate(student, date)) return;
      // Block withdrawn students
      if (matrix.matrix[studentId]?.[date] === 'WITHDRAWN') return;

      const isPast = date < todayKey;
      const completion = getDateCompletion(matrix.students, date, matrix.matrix, dirty);

      // Past day protection: ask once per day
      if (isPast && !unlockedDays.has(date)) {
        const currentStatus = getEffectiveStatus(studentId, date);
        const nextStatus = completion.isEmpty ? 'ABSENT' : getNextAttendanceStatus(currentStatus);
        setPendingConfirm({
          date,
          studentId,
          next: nextStatus,
          fillPresentFirst: completion.isEmpty,
        });
        return;
      }

      // Cycle status
      const currentStatus = getEffectiveStatus(studentId, date);
      const nextStatus = getNextAttendanceStatus(currentStatus);

      setDirty((prev) => {
        const next = new Map(prev);
        const dateMap = new Map(next.get(date) ?? []);
        dateMap.set(studentId, nextStatus);
        next.set(date, dateMap);
        return next;
      });
    },
    [dirty, matrix, unlockedDays, getEffectiveStatus],
  );

  const confirmPastDay = useCallback(() => {
    if (!pendingConfirm || !matrix) return;
    const { date, studentId, next, fillPresentFirst } = pendingConfirm;
    setUnlockedDays((prev) => new Set(prev).add(date));
    setDirty((prev) => {
      const n = new Map(prev);
      const dateMap = fillPresentFirst
        ? buildPresentStatusMap(matrix.students, date, matrix.matrix)
        : new Map(n.get(date) ?? []);
      dateMap.set(studentId, next);
      n.set(date, dateMap);
      return n;
    });
    setPendingConfirm(null);
  }, [matrix, pendingConfirm]);

  const handleDateHeaderClick = useCallback(
    (date: string) => {
      if (!matrix) return;
      if (date > matrix.today) return;
      if (matrix.nonSchoolDays[date]) return;

      const completion = getDateCompletion(matrix.students, date, matrix.matrix, dirty);
      if (completion.activeCount === 0) return;

      if (!completion.isEmpty) {
        if (completion.isPartial) {
          toast.warning('Asistencia incompleta', {
            description: `${formatGridDate(date)} tiene ${completion.missingCount} alumno${
              completion.missingCount !== 1 ? 's' : ''
            } sin estado.`,
          });
        }
        return;
      }

      const presentMap = buildPresentStatusMap(matrix.students, date, matrix.matrix);
      setDirty((prev) => {
        const next = new Map(prev);
        next.set(date, presentMap);
        return next;
      });
      if (date < matrix.today) {
        setUnlockedDays((prev) => new Set(prev).add(date));
      }
      toast.success('Día inicializado', {
        description: `${formatGridDate(date)} quedó marcado como presente.`,
      });
    },
    [dirty, matrix],
  );

  // Save mutation: sends dirty entries grouped by date
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (incompleteDirtyDates.length > 0) {
        throw new IncompleteAttendanceError('Asistencia incompleta');
      }

      const promises: Promise<unknown>[] = [];
      dirty.forEach((studentMap, date) => {
        if (studentMap.size === 0) return;
        const entries = Array.from(studentMap.entries()).map(([studentId, status]) => ({
          studentId,
          status,
        }));
        promises.push(api.post('/attendance', { courseId, date, entries }));
      });
      await Promise.all(promises);
    },
    onSuccess: () => {
      setDirty(new Map());
      void qc.invalidateQueries({ queryKey: ['course-matrix', courseId, year, month] });
      toast.success('Asistencia guardada', {
        description: `${dirtyCount} cambio${dirtyCount !== 1 ? 's' : ''} registrado${dirtyCount !== 1 ? 's' : ''}`,
      });
    },
    onError: (err) => {
      if (err instanceof IncompleteAttendanceError) {
        const firstDate = incompleteDirtyDates[0]!;
        const completion = dayCompletion.get(firstDate);
        toast.warning('Completa la asistencia antes de guardar', {
          description: completion
            ? `${formatGridDate(firstDate)} tiene ${completion.missingCount} alumno${
                completion.missingCount !== 1 ? 's' : ''
              } sin estado.`
            : undefined,
        });
        return;
      }

      if (!online || !(err instanceof ApiError)) {
        // Queue offline
        dirty.forEach((studentMap, date) => {
          if (studentMap.size === 0) return;
          const entries = Array.from(studentMap.entries()).map(([studentId, status]) => ({
            studentId,
            status,
          }));
          attendanceQueue.enqueue({ courseId, date, entries });
        });
        refreshCount();
        setDirty(new Map());
        toast.warning('Sin conexión — guardado localmente.', { duration: 5000 });
        return;
      }
      toast.error('Error al guardar', { description: (err as Error).message });
    },
  });

  const handleSave = useCallback(() => {
    if (incompleteDirtyDates.length > 0) {
      const firstDate = incompleteDirtyDates[0]!;
      const completion = dayCompletion.get(firstDate);
      toast.warning('Completa la asistencia antes de guardar', {
        description: completion
          ? `${formatGridDate(firstDate)} tiene ${completion.missingCount} alumno${
              completion.missingCount !== 1 ? 's' : ''
            } sin estado.`
          : undefined,
      });
      return;
    }
    saveMutation.mutate();
  }, [dayCompletion, incompleteDirtyDates, saveMutation]);

  const prevMonth = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else setMonth(month + 1);
  };

  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
    setTimeout(() => {
      if (todayColRef.current && scrollRef.current) {
        const container = scrollRef.current;
        const col = todayColRef.current;
        const offset =
          col.offsetLeft - container.offsetLeft - container.clientWidth / 2 + col.clientWidth / 2;
        container.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
      }
    }, 100);
  };

  // Compute today stats from effective statuses
  const todayStats = useMemo(() => {
    if (!matrix || !dates.includes(todayKey)) return null;
    let present = 0,
      absent = 0,
      late = 0,
      justified = 0,
      total = 0;
    for (const s of students) {
      if (!isStudentActiveOnDate(s, todayKey)) continue;
      const st = getEffectiveStatus(s.id, todayKey);
      if (!isAttendanceGridStatus(st)) continue;
      total++;
      if (st === 'PRESENT') present++;
      else if (st === 'ABSENT') absent++;
      else if (st === 'LATE') late++;
      else if (st === 'JUSTIFIED') justified++;
    }
    return { present, absent, late, justified, total };
  }, [matrix, students, todayKey, dates, getEffectiveStatus]);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="size-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition"
          >
            <ChevronLeft className="size-4" />
          </button>
          <h2 className="text-base font-semibold capitalize min-w-[140px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="size-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={goToToday}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition"
          >
            <CalendarDays className="size-3.5" /> Hoy
          </button>
          {dirtyCount > 0 && (
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              title={
                incompleteDirtyDates.length > 0
                  ? 'Completa todos los alumnos activos antes de guardar'
                  : undefined
              }
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Guardar ({dirtyCount})
            </button>
          )}
          {!online && (
            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-amber-500 animate-pulse" />
              Offline
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Today KPI strip */}
      {todayStats && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <span className="font-semibold text-sm text-foreground">Hoy:</span>
          <span className="rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2.5 py-1 font-medium">
            {todayStats.present} P
          </span>
          {todayStats.absent > 0 && (
            <span className="rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2.5 py-1 font-medium">
              {todayStats.absent} A
            </span>
          )}
          {todayStats.late > 0 && (
            <span className="rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-2.5 py-1 font-medium">
              {todayStats.late} AT
            </span>
          )}
          {todayStats.justified > 0 && (
            <span className="rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2.5 py-1 font-medium">
              {todayStats.justified} J
            </span>
          )}
          <span className="text-muted-foreground">
            {todayStats.total > 0
              ? `${(((todayStats.present + todayStats.late) / todayStats.total) * 100).toFixed(0)}%`
              : '—'}
          </span>
        </div>
      )}

      {incompleteDirtyDates.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Completa {formatGridDate(incompleteDirtyDates[0]!)} antes de guardar: faltan{' '}
            {dayCompletion.get(incompleteDirtyDates[0]!)?.missingCount ?? 0} alumno
            {(dayCompletion.get(incompleteDirtyDates[0]!)?.missingCount ?? 0) !== 1 ? 's' : ''}.
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="att-grid-wrapper rounded-xl border border-border bg-background overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse bg-muted rounded" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Sin alumnos activos para este período.
          </div>
        ) : (
          <div className="att-grid-scroll" ref={scrollRef}>
            <table className="att-grid-table">
              <thead>
                <tr>
                  <th className="att-grid-sticky-left att-grid-header-cell">
                    <div className="att-grid-name-col">
                      <span className="text-[10px] text-muted-foreground">#</span>
                      <span className="text-[10px] text-muted-foreground ml-1">Alumno</span>
                    </div>
                  </th>
                  {dates.map((d) => {
                    const dt = new Date(d + 'T12:00:00');
                    const day = dt.getDate();
                    const dow = DOW_LABELS[dt.getDay()]!;
                    const isToday = d === todayKey;
                    const isHoliday = !!matrix?.nonSchoolDays[d];
                    const isFuture = d > todayKey;
                    const completion = dayCompletion.get(d);
                    const isIncomplete = completion?.isPartial ?? false;
                    const isFillable =
                      !isHoliday &&
                      !isFuture &&
                      (completion?.activeCount ?? 0) > 0 &&
                      (completion?.isEmpty ?? false);
                    const title = isHoliday
                      ? matrix?.nonSchoolDays[d]?.description
                      : isIncomplete
                        ? `Asistencia incompleta: ${completion?.missingCount ?? 0} alumno${
                            (completion?.missingCount ?? 0) !== 1 ? 's' : ''
                          } sin estado`
                        : isFillable
                          ? 'Marcar día completo como presente'
                          : undefined;
                    return (
                      <th
                        key={d}
                        ref={isToday ? todayColRef : undefined}
                        className={cn(
                          'att-grid-header-cell att-grid-day-col',
                          isToday && 'att-grid-today-col',
                          isHoliday && 'att-grid-holiday-col',
                          isFuture && 'att-grid-future-col',
                          isFillable && 'att-grid-fillable-col',
                          isIncomplete && 'att-grid-incomplete-col',
                        )}
                        onClick={isHoliday || isFuture ? undefined : () => handleDateHeaderClick(d)}
                        title={title}
                      >
                        <span className="att-grid-dow">{dow}</span>
                        <span className="att-grid-day">{day}</span>
                        {isIncomplete && <span className="att-grid-missing-dot" />}
                      </th>
                    );
                  })}
                  <th className="att-grid-sticky-right att-grid-header-cell">
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, idx) => {
                  // Compute effective rate including dirty
                  let effPresent = 0,
                    effTotal = 0;
                  for (const d of dates) {
                    if (!isStudentActiveOnDate(s, d)) continue;
                    if (matrix?.matrix[s.id]?.[d] === 'WITHDRAWN') continue;
                    const st = getEffectiveStatus(s.id, d);
                    if (matrix?.nonSchoolDays[d]) continue;
                    if (!isAttendanceGridStatus(st)) continue;
                    effTotal++;
                    if (st === 'PRESENT' || st === 'LATE') effPresent++;
                  }
                  const effRate = effTotal > 0 ? effPresent / effTotal : null;

                  return (
                    <tr
                      key={s.id}
                      className={idx % 2 === 0 ? 'att-grid-row-even' : 'att-grid-row-odd'}
                    >
                      <td className="att-grid-sticky-left att-grid-name-cell">
                        <div className="att-grid-name-col">
                          <span className="att-grid-num">{s.enrollmentNumber}</span>
                          <span className="att-grid-name" title={`${s.lastName}, ${s.firstName}`}>
                            {s.lastName}, {s.firstName}
                          </span>
                        </div>
                      </td>
                      {dates.map((d) => {
                        const isHoliday = !!matrix?.nonSchoolDays[d];
                        const isFuture = d > todayKey;
                        const isToday = d === todayKey;
                        const status = getEffectiveStatus(s.id, d);
                        const isWithdrawn = status === 'WITHDRAWN';
                        const isInactive = !isStudentActiveOnDate(s, d) && !isWithdrawn;
                        const isBlocked = isFuture || isHoliday || isWithdrawn || isInactive;
                        const isDirty = isDirtyCell(s.id, d);
                        const isMissing =
                          !isBlocked &&
                          (dayCompletion.get(d)?.isPartial ?? false) &&
                          !isAttendanceGridStatus(status);

                        return (
                          <td
                            key={d}
                            className={cn(
                              'att-grid-cell',
                              status && STATUS_CELL_CLASS[status],
                              isHoliday && 'att-cell--holiday',
                              isFuture && 'att-cell--future',
                              isInactive && 'att-cell--inactive',
                              isToday && 'att-cell--today',
                              isMissing && 'att-cell--missing',
                              isDirty && 'att-cell--dirty',
                              isBlocked && 'att-cell--blocked',
                            )}
                            onClick={isBlocked ? undefined : () => handleCellClick(s.id, d)}
                            title={
                              isHoliday
                                ? matrix?.nonSchoolDays[d]?.description
                                : isWithdrawn
                                  ? 'Retirado'
                                  : isFuture
                                    ? 'Día futuro'
                                    : isInactive
                                      ? 'Fuera de matrícula'
                                      : isMissing
                                        ? 'Falta estado de asistencia'
                                        : status
                                          ? STATUS_SHORT[status]
                                          : 'Sin registro'
                            }
                          >
                            {status
                              ? (STATUS_SHORT[status] ?? '·')
                              : isHoliday || isInactive
                                ? '·'
                                : ''}
                          </td>
                        );
                      })}
                      <td className="att-grid-sticky-right att-grid-rate-cell">
                        <span className={cn('att-rate-badge', rateBadge(effRate))}>
                          {effRate != null ? `${(effRate * 100).toFixed(0)}` : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="att-grid-legend">
          <div className="att-legend-item">
            <span className="att-legend-dot att-cell--present" />P
          </div>
          <div className="att-legend-item">
            <span className="att-legend-dot att-cell--absent" />A
          </div>
          <div className="att-legend-item">
            <span className="att-legend-dot att-cell--late" />
            AT
          </div>
          <div className="att-legend-item">
            <span className="att-legend-dot att-cell--justified" />J
          </div>
          <div className="att-legend-item">
            <span className="att-legend-dot att-cell--missing" />
            Falta
          </div>
          <div className="att-legend-item">
            <span className="att-legend-dot att-cell--holiday" />
            Feriado
          </div>
          <div className="att-legend-item">
            <span className="att-legend-dot att-cell--future" />
            Futuro
          </div>
        </div>
      </div>

      {/* Past-day confirmation toast */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setPendingConfirm(null)}
        >
          <div
            className="w-full sm:max-w-sm bg-background border-t sm:border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">¿Editar día anterior?</p>
            <p className="text-xs text-muted-foreground">
              Estás modificando el{' '}
              <strong>
                {new Date(pendingConfirm.date + 'T12:00:00').toLocaleDateString('es-CL', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </strong>
              .{' '}
              {pendingConfirm.fillPresentFirst
                ? 'Se marcará el curso como presente y esta celda quedará como ausente.'
                : 'Una vez confirmado, podrás editar libremente ese día.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingConfirm(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-border text-sm font-medium hover:bg-muted transition"
              >
                Cancelar
              </button>
              <button
                onClick={confirmPastDay}
                className="flex-1 min-h-[44px] rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
