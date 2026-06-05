import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Info,
  LayoutGrid,
  Printer,
  Search,
  Users,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { api, downloadBlob } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateLocal } from '@/lib/date';
import { formatStudentFullName } from '@/lib/student-name';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { EmptyState } from '@/components/ui/EmptyState';
import { useEffectiveSchoolId } from '@/stores/school.store';
import {
  manualFormulaText,
  statusDatesForStudent,
  totalClasses,
  type ReviewableAttendanceStatus,
} from '@/features/reports/attendance-report.logic';

export const Route = createFileRoute('/_auth/reportes')({
  component: ReportsPage,
});

type Course = { id: string; name: string; code: string };
type Student = {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  rut: string;
};

type MatrixStudent = {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  enrollmentNumber: number;
  enrolledAt?: string;
  withdrawnAt?: string | null;
  total: number;
  present: number;
  absent: number;
  late?: number;
  justified: number;
  missing?: number;
  attended?: number;
  totalClasses?: number;
  attendanceRate?: number | null;
  formulaVersion?: string;
  rate: number | null;
};

type SummaryStudent = {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  enrollmentNumber: number;
  total: number;
  present: number;
  absent: number;
  late: number;
  justified: number;
  missing?: number;
  attended?: number;
  totalClasses?: number;
  attendanceRate?: number | null;
  formulaVersion?: string;
  rate: number | null;
};

type SummaryData = {
  students: SummaryStudent[];
  period: {
    from: string;
    to: string;
    label?: string;
    source?: 'saved' | 'default';
    ranges?: Array<{ from: string; to: string }>;
  };
};

type MatrixData = {
  students: MatrixStudent[];
  dates: string[];
  matrix: Record<string, Record<string, string>>;
  nonSchoolDays?: Record<string, { type: string; description: string }>;
  schoolDays?: string[];
  today?: string;
};

type ReviewMonth = { year: number; month: number };

type StatusReviewRequest = {
  courseId: string;
  studentId: string;
  studentName: string;
  status: ReviewableAttendanceStatus;
  periodLabel: string;
  courseName: string;
  months: ReviewMonth[];
  initialMatrix?: MatrixData;
};

type AcademicYearConfig = {
  source: 'saved' | 'default';
  firstSemester: { startDate: string; endDate: string };
  secondSemester: { startDate: string; endDate: string };
  annual: { ranges: Array<{ startDate: string; endDate: string }> };
};

const JUNE_LAST_DAY = 18;
const CRITICAL_THRESHOLD = 0.85;

function snapToMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0]!;
}

function formatWeekLabel(mondayIso: string): string {
  const mon = new Date(mondayIso + 'T12:00:00');
  const fri = new Date(mon);
  fri.setDate(fri.getDate() + 4);
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
  return `${fmt(mon)} – ${fmt(fri)} ${fri.getFullYear()}`;
}

function shiftWeek(mondayIso: string, delta: number): string {
  const d = new Date(mondayIso + 'T12:00:00');
  d.setDate(d.getDate() + delta * 7);
  return d.toISOString().split('T')[0]!;
}

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

function isStudentActiveForDate(student: MatrixStudent, dateKey: string): boolean {
  const enrolledAt = student.enrolledAt?.slice(0, 10);
  const withdrawnAt = student.withdrawnAt?.slice(0, 10);
  if (enrolledAt && dateKey < enrolledAt) return false;
  if (withdrawnAt && dateKey > withdrawnAt) return false;
  return true;
}

type MonthlyBreakdownData = {
  students: {
    id: string;
    firstName: string;
    lastName: string;
    secondLastName?: string | null;
    enrollmentNumber: number;
  }[];
  months: {
    month: number;
    year: number;
    from: string;
    to: string;
    stats: Record<
      string,
      {
        total: number;
        present: number;
        absent: number;
        late: number;
        justified: number;
        missing?: number;
        attended?: number;
        totalClasses?: number;
        attendanceRate?: number | null;
        formulaVersion?: string;
        rate: number | null;
      }
    >;
  }[];
  period: {
    label: string;
    source: 'saved' | 'default';
    from: string;
    to: string;
    ranges: Array<{ from: string; to: string }>;
  };
};

type Tab = 'resumen' | 'planilla' | 'exportar';
type PeriodType = 'mensual' | 'semestral' | 'anual';

function ReportsPage() {
  const schoolId = useEffectiveSchoolId();
  const today = new Date();

  const [tab, setTab] = useState<Tab>('resumen');
  const [courseId, setCourseId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [semester, setSemester] = useState(today.getMonth() < 6 ? 1 : 2);
  const [periodType, setPeriodType] = useState<PeriodType>('mensual');
  const [weekStart, setWeekStart] = useState(() => snapToMonday(new Date()));
  const [loading, setLoading] = useState<string | null>(null);

  const { data: courses } = useQuery<Course[]>({
    queryKey: ['courses', schoolId],
    queryFn: () => api.get(`/courses?schoolId=${schoolId}`),
    enabled: !!schoolId,
  });

  const { data: students } = useQuery<Student[]>({
    queryKey: ['students', courseId],
    queryFn: () => api.get(`/students?courseId=${courseId}`),
    enabled: !!courseId,
  });

  const { data: academicConfig } = useQuery<AcademicYearConfig>({
    queryKey: ['school-academic-year-config', schoolId, year],
    queryFn: () => api.get(`/school-config/${schoolId}/academic-year/${year}`),
    enabled: !!schoolId,
  });

  const { data: matrix, isLoading: matrixLoading } = useQuery<MatrixData>({
    queryKey: ['course-matrix-report', courseId, year, month],
    queryFn: () => api.get(`/attendance/course/${courseId}/matrix?year=${year}&month=${month}`),
    enabled: !!courseId && periodType === 'mensual',
  });

  const summaryPath = useMemo(() => {
    if (!courseId || periodType === 'mensual') return null;
    if (periodType === 'semestral') {
      return `/attendance/course/${courseId}/summary?period=semester&year=${year}&semester=${semester}`;
    }
    return `/attendance/course/${courseId}/summary?period=annual&year=${year}`;
  }, [courseId, periodType, semester, year]);

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryData>({
    queryKey: ['course-summary-report', courseId, periodType, year, semester],
    queryFn: () => api.get(summaryPath!),
    enabled: !!summaryPath,
  });

  const breakdownPath = useMemo(() => {
    if (!courseId || periodType === 'mensual') return null;
    if (periodType === 'semestral') {
      return `/attendance/course/${courseId}/monthly-breakdown?period=semester&year=${year}&semester=${semester}`;
    }
    return `/attendance/course/${courseId}/monthly-breakdown?period=annual&year=${year}`;
  }, [courseId, periodType, semester, year]);

  const { data: breakdown, isLoading: breakdownLoading } = useQuery<MonthlyBreakdownData>({
    queryKey: ['course-monthly-breakdown', courseId, periodType, year, semester],
    queryFn: () => api.get(breakdownPath!),
    enabled: !!breakdownPath,
  });

  const juneLastDay = useMemo(() => {
    const firstSemesterEnd = academicConfig?.firstSemester.endDate;
    if (!firstSemesterEnd?.startsWith(`${year}-06-`)) return JUNE_LAST_DAY;
    return Number(firstSemesterEnd.slice(8, 10)) || JUNE_LAST_DAY;
  }, [academicConfig?.firstSemester.endDate, year]);

  const filteredDates = useMemo(() => {
    if (!matrix?.dates) return [];
    if (month !== 6) return matrix.dates;
    return matrix.dates.filter((d) => {
      const day = new Date(d + 'T12:00').getDate();
      return day <= juneLastDay;
    });
  }, [juneLastDay, matrix?.dates, month]);

  const recalculatedStudents = useMemo(() => {
    if (!matrix?.students || !matrix.matrix || filteredDates.length === 0) return [];
    const dateSet = new Set(filteredDates);
    const todayKey = matrix.today ?? formatDateLocal(new Date());
    const denominatorDates = (matrix.schoolDays ?? filteredDates).filter(
      (dateKey) => dateSet.has(dateKey) && dateKey <= todayKey && !matrix.nonSchoolDays?.[dateKey],
    );
    return matrix.students.map((s) => {
      const records = matrix.matrix[s.id];
      const activeDates = denominatorDates.filter((dateKey) => isStudentActiveForDate(s, dateKey));
      const totalClasses = activeDates.length;
      let total = 0;
      let present = 0;
      let absent = 0;
      let late = 0;
      let justified = 0;
      for (const dateKey of activeDates) {
        const status = records?.[dateKey];
        if (status === 'WITHDRAWN') continue;
        if (status === 'PRESENT') {
          total++;
          present++;
        } else if (status === 'ABSENT') {
          total++;
          absent++;
        } else if (status === 'LATE') {
          total++;
          late++;
        } else if (status === 'JUSTIFIED') {
          total++;
          justified++;
        }
      }
      const missing = Math.max(0, totalClasses - total);
      const attended = present + late;
      const rate = totalClasses > 0 ? attended / totalClasses : null;
      return {
        ...s,
        total: totalClasses,
        present,
        absent,
        justified,
        late,
        missing,
        attended,
        totalClasses,
        attendanceRate: rate,
        formulaVersion: 'PRESENT_LATE_OVER_TOTAL_CLASSES_V1',
        rate,
      };
    });
  }, [matrix, filteredDates]);

  const sortedStudents = useMemo(
    () => [...recalculatedStudents].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1)),
    [recalculatedStudents],
  );

  const sortedSummaryStudents = useMemo(() => {
    if (!summary?.students) return [];
    return [...summary.students].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1));
  }, [summary]);

  const validRates = recalculatedStudents.filter((s) => s.rate != null);
  const avgRate =
    validRates.length > 0
      ? validRates.reduce((acc, s) => acc + s.rate!, 0) / validRates.length
      : null;
  const belowCritical = recalculatedStudents.filter(
    (s) => s.rate != null && s.rate < CRITICAL_THRESHOLD,
  ).length;

  const validSummaryRates = sortedSummaryStudents.filter((s) => s.rate != null);
  const avgSummaryRate =
    validSummaryRates.length > 0
      ? validSummaryRates.reduce((acc, s) => acc + s.rate!, 0) / validSummaryRates.length
      : null;
  const belowSummaryCritical = sortedSummaryStudents.filter(
    (s) => s.rate != null && s.rate < CRITICAL_THRESHOLD,
  ).length;

  const download = async (type: string, path: string, filename: string) => {
    if (!courseId) {
      toast.error('Selecciona un curso');
      return;
    }
    setLoading(type);
    try {
      await downloadBlob(path, filename);
      toast.success('Reporte descargado');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const downloadStudent = async (type: string, path: string, filename: string) => {
    if (!studentId) {
      toast.error('Selecciona un estudiante');
      return;
    }
    setLoading(type);
    try {
      await downloadBlob(path, filename);
      toast.success('Certificado descargado');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const courseLabel = courses?.find((c) => c.id === courseId)?.code ?? 'CURSO';
  const studentLabel = students?.find((s) => s.id === studentId)?.lastName ?? 'ESTUDIANTE';
  const firstSemesterLabel = academicConfig
    ? `1er Semestre (${formatDateRange(academicConfig.firstSemester.startDate, academicConfig.firstSemester.endDate)})`
    : '1er Semestre';
  const secondSemesterLabel = academicConfig
    ? `2do Semestre (${formatDateRange(academicConfig.secondSemester.startDate, academicConfig.secondSemester.endDate)})`
    : '2do Semestre';
  const selectedPeriodDetail =
    periodType === 'semestral'
      ? semester === 1
        ? firstSemesterLabel
        : secondSemesterLabel
      : periodType === 'anual' && academicConfig
        ? `Año escolar (${formatAnnualRanges(academicConfig.annual.ranges)})`
        : '';

  const handlePeriodChange = (newPeriod: PeriodType) => {
    setPeriodType(newPeriod);
    if (newPeriod === 'mensual' && tab === 'planilla') {
      setTab('resumen');
    }
  };

  const tabs: { id: Tab; label: string; Icon: typeof Users; disabled?: boolean }[] = [
    { id: 'resumen', label: 'Resumen', Icon: Users },
    { id: 'planilla', label: 'Planilla', Icon: LayoutGrid, disabled: periodType === 'mensual' },
    { id: 'exportar', label: 'Exportar', Icon: Download },
  ];

  return (
    <div className="max-w-5xl space-y-4 overflow-hidden">
      <div className="no-print">
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Consulta y exporta la asistencia de tus cursos
        </p>
      </div>

      {!schoolId ? (
        <EmptyState
          icon={GraduationCap}
          title="Sin colegio asignado"
          description="Tu cuenta no está vinculada a un colegio. Contacta a un administrador."
        />
      ) : (
        <>
          <div className="rounded-xl border border-border bg-background p-4 space-y-3 no-print">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Curso</label>
              <select
                value={courseId}
                onChange={(e) => {
                  setCourseId(e.target.value);
                  setStudentId('');
                }}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
              >
                <option value="">— Selecciona un curso —</option>
                {courses?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="w-full sm:w-24">
                <label className="text-xs text-muted-foreground block mb-1.5">Año</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  min={2020}
                  max={2030}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                />
              </div>

              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1.5">Período</label>
                <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
                  {(['mensual', 'semestral', 'anual'] as PeriodType[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePeriodChange(p)}
                      className={cn(
                        'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition capitalize',
                        periodType === p
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-background',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {periodType === 'mensual' && (
                <div className="w-full sm:w-36">
                  <label className="text-xs text-muted-foreground block mb-1.5">Mes</label>
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  >
                    {MONTH_NAMES.map((m, i) => (
                      <option key={i} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {periodType === 'semestral' && (
                <div className="w-full sm:w-48">
                  <label className="text-xs text-muted-foreground block mb-1.5">Semestre</label>
                  <select
                    value={semester}
                    onChange={(e) => setSemester(Number(e.target.value))}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  >
                    <option value={1}>{firstSemesterLabel}</option>
                    <option value={2}>{secondSemesterLabel}</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-border no-print">
            {tabs.map(({ id, label, Icon, disabled }) => (
              <button
                key={id}
                type="button"
                onClick={() => !disabled && setTab(id)}
                disabled={disabled}
                title={disabled ? 'Disponible solo para períodos semestral o anual' : undefined}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition whitespace-nowrap',
                  tab === id && !disabled
                    ? 'border-primary text-primary'
                    : disabled
                      ? 'border-transparent text-muted-foreground/50 cursor-not-allowed'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'resumen' ? (
            <ResumenTab
              courseId={courseId}
              courseName={courses?.find((c) => c.id === courseId)?.name ?? ''}
              periodType={periodType}
              month={month}
              year={year}
              semester={semester}
              matrix={matrix}
              breakdown={breakdown}
              juneLastDay={juneLastDay}
              periodDetail={selectedPeriodDetail}
              matrixLoading={matrixLoading}
              summaryLoading={summaryLoading}
              sortedStudents={sortedStudents}
              sortedSummaryStudents={sortedSummaryStudents}
              avgRate={avgRate}
              avgSummaryRate={avgSummaryRate}
              belowCritical={belowCritical}
              belowSummaryCritical={belowSummaryCritical}
            />
          ) : tab === 'planilla' ? (
            <PlanillaTab
              courseId={courseId}
              courseName={courses?.find((c) => c.id === courseId)?.name ?? ''}
              breakdown={breakdown}
              breakdownLoading={breakdownLoading}
            />
          ) : (
            <ExportarTab
              courseId={courseId}
              studentId={studentId}
              students={students}
              setStudentId={setStudentId}
              year={year}
              month={month}
              semester={semester}
              weekStart={weekStart}
              setWeekStart={setWeekStart}
              courseLabel={courseLabel}
              studentLabel={studentLabel}
              loading={loading}
              download={download}
              downloadStudent={downloadStudent}
              academicConfig={academicConfig}
            />
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: 'green' | 'amber' | 'red' | 'muted';
  sub?: string;
}) {
  const colorClasses = {
    green: 'text-green-600 dark:text-green-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
    muted: 'text-foreground',
  };

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
        {label}
      </p>
      <p className={cn('text-2xl font-bold mt-1', colorClasses[color])}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function RateBadge({ rate }: { rate: number | null }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-semibold',
        rate == null
          ? 'bg-muted text-muted-foreground'
          : rate >= 0.9
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : rate >= CRITICAL_THRESHOLD
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      )}
    >
      {rate != null ? `${(rate * 100).toFixed(1)}%` : '—'}
    </span>
  );
}

function isReviewableStatus(status: string | undefined): status is ReviewableAttendanceStatus {
  return status === 'ABSENT' || status === 'LATE' || status === 'JUSTIFIED';
}

const STATUS_REVIEW_LABELS: Record<
  ReviewableAttendanceStatus,
  { label: string; short: string; text: string; badge: string }
> = {
  ABSENT: {
    label: 'Ausentes',
    short: 'A',
    text: 'text-red-600 dark:text-red-400',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  LATE: {
    label: 'Atrasos',
    short: 'AT',
    text: 'text-orange-600 dark:text-orange-400',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
  JUSTIFIED: {
    label: 'Justificados',
    short: 'J',
    text: 'text-yellow-600 dark:text-yellow-400',
    badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
};

function StatusCountButton({
  value,
  status,
  onOpen,
  className,
}: {
  value: number;
  status: ReviewableAttendanceStatus;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'rounded px-1.5 py-0.5 tabular-nums transition',
        'underline decoration-dotted underline-offset-2 cursor-pointer',
        'hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40',
        STATUS_REVIEW_LABELS[status].text,
        className,
      )}
      title={`Ver ${STATUS_REVIEW_LABELS[status].label.toLowerCase()}`}
      aria-label={`Revisar ${STATUS_REVIEW_LABELS[status].label.toLowerCase()}`}
    >
      {value}
    </button>
  );
}

function StatusReviewModal({
  request,
  onClose,
}: {
  request: StatusReviewRequest | null;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { data: fetchedMatrices, isLoading } = useQuery<MatrixData[]>({
    queryKey: ['status-review-matrices', request?.courseId, request?.studentId, request?.months],
    queryFn: async () => {
      if (!request) return [];
      return Promise.all(
        request.months.map((entry) =>
          api.get<MatrixData>(
            `/attendance/course/${request.courseId}/matrix?year=${entry.year}&month=${entry.month}`,
          ),
        ),
      );
    },
    enabled: !!request && !request.initialMatrix && request.months.length > 0,
  });

  const matrices = request
    ? request.initialMatrix
      ? [request.initialMatrix]
      : (fetchedMatrices ?? [])
    : [];
  const dates = request ? statusDatesForStudent(matrices, request.studentId, request.status) : [];
  const cfg = request ? STATUS_REVIEW_LABELS[request.status] : STATUS_REVIEW_LABELS.ABSENT;

  // Group dates by month (no useMemo — dates ref changes each render)
  const grouped = (() => {
    const map = new Map<string, string[]>();
    for (const d of dates) {
      const key = d.slice(0, 7); // YYYY-MM
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  })();

  if (!request) return null;

  const toggleMonth = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatMonthHeader = (key: string) => {
    const [y, m] = key.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  };

  const formatDayCompact = (date: string) => {
    const d = new Date(`${date}T12:00:00`);
    const weekday = d.toLocaleDateString('es-CL', { weekday: 'short' });
    const day = d.getDate().toString().padStart(2, '0');
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-review-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 id="status-review-title" className="text-sm font-semibold">
              {cfg.label} de {request.studentName}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {request.courseName} · {request.periodLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
            aria-label="Cerrar"
          >
            <XCircle className="size-4 mx-auto" />
          </button>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', cfg.badge)}>
              {cfg.short}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              Total: {isLoading ? '…' : dates.length} {dates.length === 1 ? 'día' : 'días'}
            </span>
          </div>
          <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-border">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Cargando fechas…</div>
            ) : grouped.length > 0 ? (
              <div className="divide-y divide-border">
                {grouped.map(([monthKey, monthDates]) => {
                  const isCollapsed = collapsed.has(monthKey);
                  return (
                    <div key={monthKey}>
                      <button
                        type="button"
                        onClick={() => toggleMonth(monthKey)}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold bg-muted/30 hover:bg-muted/50 transition"
                      >
                        <span className="flex items-center gap-1.5">
                          {isCollapsed ? (
                            <ChevronRight className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          )}
                          {formatMonthHeader(monthKey)}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                            cfg.badge,
                          )}
                        >
                          {monthDates.length}
                        </span>
                      </button>
                      {!isCollapsed && (
                        <ul className="divide-y divide-border/50">
                          {monthDates.map((date) => (
                            <li
                              key={date}
                              className="flex items-center justify-between px-4 pl-8 py-1.5 text-sm"
                            >
                              <span className="text-foreground">{formatDayCompact(date)}</span>
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {date}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                No hay fechas para este estado en el período seleccionado.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResumenTab({
  courseId,
  courseName,
  periodType,
  month,
  year,
  semester,
  matrix,
  breakdown,
  juneLastDay,
  periodDetail,
  matrixLoading,
  summaryLoading,
  sortedStudents,
  sortedSummaryStudents,
  avgRate,
  avgSummaryRate,
  belowCritical,
  belowSummaryCritical,
}: {
  courseId: string;
  courseName: string;
  periodType: PeriodType;
  month: number;
  year: number;
  semester: number;
  matrix: MatrixData | undefined;
  breakdown: MonthlyBreakdownData | undefined;
  juneLastDay: number;
  periodDetail: string;
  matrixLoading: boolean;
  summaryLoading: boolean;
  sortedStudents: (MatrixStudent & { late: number })[];
  sortedSummaryStudents: SummaryStudent[];
  avgRate: number | null;
  avgSummaryRate: number | null;
  belowCritical: number;
  belowSummaryCritical: number;
}) {
  const [review, setReview] = useState<StatusReviewRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<
    'num' | 'name' | 'present' | 'absent' | 'late' | 'justified' | 'classes' | 'rate'
  >('rate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const searchRef = useRef<HTMLInputElement>(null);

  const isMonthly = periodType === 'mensual';
  const periodLabel = isMonthly
    ? `${MONTH_NAMES[month - 1]} ${year}`
    : periodType === 'semestral'
      ? `${semester === 1 ? '1er' : '2do'} Semestre ${year}`
      : `Año ${year}`;
  const reviewMonths = isMonthly
    ? [{ year, month }]
    : (breakdown?.months.map((entry) => ({ year: entry.year, month: entry.month })) ?? []);
  const openStatusReview = (
    student: Pick<SummaryStudent, 'id' | 'firstName' | 'lastName' | 'secondLastName'>,
    status: ReviewableAttendanceStatus,
  ) => {
    setReview({
      courseId,
      studentId: student.id,
      studentName: formatStudentFullName(student),
      status,
      periodLabel,
      courseName,
      months: reviewMonths,
      ...(isMonthly && matrix ? { initialMatrix: matrix } : {}),
    });
  };

  // Keyboard shortcut: Ctrl+F focuses search
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && searchRef.current) {
      e.preventDefault();
      searchRef.current.focus();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const isLoading = isMonthly ? matrixLoading : summaryLoading;
  const rawStudents = isMonthly ? sortedStudents : sortedSummaryStudents;
  const avg = isMonthly ? avgRate : avgSummaryRate;
  const below = isMonthly ? belowCritical : belowSummaryCritical;

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return rawStudents;
    const q = searchQuery.toLowerCase().trim();
    return rawStudents.filter((s) => formatStudentFullName(s).toLowerCase().includes(q));
  }, [rawStudents, searchQuery]);

  // Sort
  const students = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'num':
          return dir * (a.enrollmentNumber - b.enrollmentNumber);
        case 'name':
          return dir * formatStudentFullName(a).localeCompare(formatStudentFullName(b));
        case 'present':
          return dir * (a.present - b.present);
        case 'absent':
          return dir * (a.absent - b.absent);
        case 'late':
          return dir * (a.late - b.late);
        case 'justified':
          return dir * (a.justified - b.justified);
        case 'classes':
          return dir * (totalClasses(a) - totalClasses(b));
        case 'rate':
          return dir * ((a.rate ?? -1) - (b.rate ?? -1));
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  if (!courseId) {
    return (
      <EmptyState
        icon={Users}
        title="Selecciona un curso"
        description="Elige un curso para ver el resumen de asistencia."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-background p-10 text-center">
        <div className="h-6 w-32 animate-pulse bg-muted rounded mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Cargando datos…</p>
      </div>
    );
  }

  if (rawStudents.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background p-10 text-center">
        <Users className="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          Sin registros para {periodLabel}
        </p>
      </div>
    );
  }

  const showJuneBanner = isMonthly && month === 6;
  const showIncompleteBanner =
    !isMonthly &&
    sortedSummaryStudents.length > 0 &&
    sortedSummaryStudents.some((s) => s.present + s.absent + s.late + s.justified === 0);

  const avgColor =
    avg == null ? 'muted' : avg >= 0.9 ? 'green' : avg >= CRITICAL_THRESHOLD ? 'amber' : 'red';

  const SortHeader = ({
    col,
    label,
    align = 'center',
  }: {
    col: typeof sortKey;
    label: string;
    align?: 'left' | 'center' | 'right';
  }) => (
    <th
      className={cn(
        'px-3 py-2.5 cursor-pointer select-none hover:bg-muted/30 transition',
        align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center',
      )}
      onClick={() => toggleSort(col)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortKey === col ? (
          sortDir === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-2.5 opacity-30" />
        )}
      </span>
    </th>
  );

  return (
    <>
      <div className="space-y-4">
        {showJuneBanner && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-200">
              <span className="font-semibold">Junio:</span> período evaluado hasta el día{' '}
              {juneLastDay} (último día de clases)
            </p>
          </div>
        )}

        {showIncompleteBanner && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-300 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
            <Info className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <p className="text-xs text-blue-800 dark:text-blue-200">
              <span className="font-semibold">Período en curso:</span> denominador cortado hasta hoy
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <KpiCard
            label="Asistencia promedio"
            value={avg != null ? `${(avg * 100).toFixed(1)}%` : '—'}
            color={avgColor}
          />
          <KpiCard
            label={`Bajo ${CRITICAL_THRESHOLD * 100}%`}
            value={String(below)}
            color={below > 0 ? 'red' : 'green'}
            sub="alumnos críticos"
          />
          <KpiCard label="Total alumnos" value={String(rawStudents.length)} color="muted" />
        </div>

        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="size-4" />
                  Lista de asistencia — {periodLabel}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {periodDetail
                    ? `${periodDetail}. Bajo ${CRITICAL_THRESHOLD * 100}% en rojo`
                    : `Bajo ${CRITICAL_THRESHOLD * 100}% en rojo`}
                </p>
              </div>
              <div className="relative w-48 shrink-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar alumno…"
                  className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {searchQuery && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums">
                    {students.length}/{rawStudents.length}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                  <SortHeader col="num" label="#" align="left" />
                  <SortHeader col="name" label="Alumno" align="left" />
                  <SortHeader col="present" label="Pres." />
                  <SortHeader col="absent" label="Aus." />
                  <SortHeader col="late" label="Atr." />
                  <SortHeader col="justified" label="Just." />
                  <SortHeader col="classes" label="Clases" />
                  <SortHeader col="rate" label="%" align="right" />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const isCritical = s.rate != null && s.rate < CRITICAL_THRESHOLD;
                  const hasMissing = (s.missing ?? 0) > 0;
                  return (
                    <tr
                      key={s.id}
                      className={cn(
                        'border-t border-border transition',
                        isCritical
                          ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30'
                          : 'hover:bg-muted/20',
                      )}
                    >
                      <td className="px-3 py-2 text-muted-foreground text-xs tabular-nums">
                        {s.enrollmentNumber}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          {isCritical && (
                            <AlertTriangle className="size-3.5 text-red-500 shrink-0" />
                          )}
                          <span className="truncate" title={formatStudentFullName(s)}>
                            {formatStudentFullName(s)}
                          </span>
                          {hasMissing && (
                            <span
                              className="size-2 rounded-full bg-orange-400 shrink-0"
                              title={`${s.missing} ${s.missing === 1 ? 'día sin registro' : 'días sin registro'}`}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-green-600 dark:text-green-400">
                        {s.present}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusCountButton
                          value={s.absent}
                          status="ABSENT"
                          onOpen={() => openStatusReview(s, 'ABSENT')}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusCountButton
                          value={s.late}
                          status="LATE"
                          onOpen={() => openStatusReview(s, 'LATE')}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusCountButton
                          value={s.justified}
                          status="JUSTIFIED"
                          onOpen={() => openStatusReview(s, 'JUSTIFIED')}
                        />
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                        {totalClasses(s)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex flex-col items-end gap-0.5">
                          <RateBadge rate={s.rate} />
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {manualFormulaText(s)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile view */}
          <div className="sm:hidden divide-y divide-border">
            {students.map((s) => {
              const isCritical = s.rate != null && s.rate < CRITICAL_THRESHOLD;
              const hasMissing = (s.missing ?? 0) > 0;
              return (
                <div
                  key={s.id}
                  className={cn('px-4 py-3', isCritical && 'bg-red-50 dark:bg-red-950/20')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-5 shrink-0">
                        {s.enrollmentNumber}
                      </span>
                      {isCritical && <AlertTriangle className="size-3.5 text-red-500 shrink-0" />}
                      <span
                        className="text-sm font-medium truncate"
                        title={formatStudentFullName(s)}
                      >
                        {formatStudentFullName(s)}
                      </span>
                      {hasMissing && (
                        <span
                          className="size-2 rounded-full bg-orange-400 shrink-0"
                          title={`${s.missing} día(s) sin registro`}
                        />
                      )}
                    </div>
                    <RateBadge rate={s.rate} />
                  </div>
                  <div className="mt-1 pl-7 text-[10px] text-muted-foreground tabular-nums">
                    {manualFormulaText(s)} · {totalClasses(s)} clases
                  </div>
                  <div className="flex gap-3 mt-2 text-xs pl-7">
                    <span className="text-green-600 dark:text-green-400">
                      <span className="text-muted-foreground">P:</span> {s.present}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      <span className="text-muted-foreground">A:</span>{' '}
                      <StatusCountButton
                        value={s.absent}
                        status="ABSENT"
                        onOpen={() => openStatusReview(s, 'ABSENT')}
                        className="px-0.5"
                      />
                    </span>
                    <span className="text-orange-600 dark:text-orange-400">
                      <span className="text-muted-foreground">AT:</span>{' '}
                      <StatusCountButton
                        value={s.late}
                        status="LATE"
                        onOpen={() => openStatusReview(s, 'LATE')}
                        className="px-0.5"
                      />
                    </span>
                    <span className="text-yellow-600 dark:text-yellow-400">
                      <span className="text-muted-foreground">J:</span>{' '}
                      <StatusCountButton
                        value={s.justified}
                        status="JUSTIFIED"
                        onOpen={() => openStatusReview(s, 'JUSTIFIED')}
                        className="px-0.5"
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-4 py-2.5 border-t border-border bg-muted/20 space-y-1">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="size-3 shrink-0" />% = (Presentes + Atrasos) × 100 / Clases.
              Justificados y sin registro no suman.
            </p>
            {showJuneBanner && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="size-3 shrink-0" />
                Período evaluado: 1 al {juneLastDay} de junio (último día de clases).
              </p>
            )}
            {below > 0 && (
              <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
                <XCircle className="size-3 shrink-0" />
                {below} {below === 1 ? 'alumno bajo' : 'alumnos bajo'} {CRITICAL_THRESHOLD * 100}% —
                atención prioritaria MINEDUC.
              </p>
            )}
          </div>
        </div>
      </div>
      <StatusReviewModal request={review} onClose={() => setReview(null)} />
    </>
  );
}

const MONTH_COLORS = [
  { bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-400' },
  { bg: 'bg-emerald-50 dark:bg-emerald-950/20', text: 'text-emerald-700 dark:text-emerald-400' },
  { bg: 'bg-violet-50 dark:bg-violet-950/20', text: 'text-violet-700 dark:text-violet-400' },
  { bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-400' },
  { bg: 'bg-rose-50 dark:bg-rose-950/20', text: 'text-rose-700 dark:text-rose-400' },
  { bg: 'bg-cyan-50 dark:bg-cyan-950/20', text: 'text-cyan-700 dark:text-cyan-400' },
];

function PlanillaTab({
  courseId,
  courseName,
  breakdown,
  breakdownLoading,
}: {
  courseId: string;
  courseName: string;
  breakdown: MonthlyBreakdownData | undefined;
  breakdownLoading: boolean;
}) {
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);

  if (!courseId) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Selecciona un curso"
        description="Elige un curso para ver la planilla de asistencia."
      />
    );
  }

  if (breakdownLoading) {
    return (
      <div className="rounded-xl border border-border bg-background p-10 text-center">
        <div className="h-6 w-32 animate-pulse bg-muted rounded mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Cargando planilla…</p>
      </div>
    );
  }

  if (!breakdown || breakdown.months.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background p-10 text-center">
        <LayoutGrid className="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Sin datos para este período</p>
      </div>
    );
  }

  const { students, months } = breakdown;

  const studentAverages = students.map((student) => {
    let totalDays = 0;
    let totalPresent = 0;
    for (const month of months) {
      const stats = month.stats[student.id];
      if (stats) {
        totalDays += stats.totalClasses ?? stats.total;
        totalPresent += stats.attended ?? stats.present + stats.late;
      }
    }
    const rate = totalDays > 0 ? totalPresent / totalDays : null;
    return { ...student, rate };
  });

  const sortedStudents = [...studentAverages].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1));

  const monthAverages = months.map((month) => {
    const rates = Object.values(month.stats)
      .map((s) => s.rate)
      .filter((r): r is number => r !== null);
    return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  });

  const toggleMonth = (month: number) => {
    setExpandedMonth(expandedMonth === month ? null : month);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background overflow-hidden planilla-print-target">
        {/* Print-only institutional header */}
        <div className="print-only print-header">
          <img src="/logo-cssp.png" alt="" className="print-header-logo" />
          <div className="print-header-text">
            <h1>Colegio San Sebastián de la Pintana</h1>
            <p>Planilla de Asistencia — {breakdown.period.label}</p>
            <p>Curso: {courseName}</p>
          </div>
          <div className="print-header-meta">
            <strong>{breakdown.period.label}</strong>
            <span>Emitido: {new Date().toLocaleDateString('es-CL')}</span>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border no-print">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <LayoutGrid className="size-4" />
                Planilla de asistencia — {breakdown.period.label}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Haz clic en un mes para ver el detalle día a día
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition"
              title="Imprimir planilla"
            >
              <Printer className="size-3.5" />
              Imprimir
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <th className="text-left px-4 py-2.5 sticky left-0 bg-muted/50 z-10">#</th>
                <th className="text-left px-4 py-2.5 sticky left-10 bg-muted/50 z-10 min-w-[160px]">
                  Alumno
                </th>
                {months.map((month, idx) => {
                  const color = MONTH_COLORS[idx % MONTH_COLORS.length]!;
                  const isExpanded = expandedMonth === month.month;
                  return (
                    <th
                      key={month.month}
                      className={cn(
                        'text-center px-2 py-2.5 cursor-pointer transition hover:opacity-80',
                        color.bg,
                      )}
                      onClick={() => toggleMonth(month.month)}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {isExpanded ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                        <span className={cn('text-[11px]', color.text)}>
                          {MONTH_NAMES[month.month - 1]?.slice(0, 3)}
                        </span>
                      </div>
                      <div className="text-[10px] font-normal mt-0.5 opacity-70">
                        {monthAverages[idx] != null
                          ? `${(monthAverages[idx]! * 100).toFixed(0)}%`
                          : '—'}
                      </div>
                    </th>
                  );
                })}
                <th className="text-right px-4 py-2.5">Prom.</th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((student, idx) => {
                const isCritical = student.rate != null && student.rate < CRITICAL_THRESHOLD;
                return (
                  <tr
                    key={student.id}
                    className={cn(
                      'border-t border-border transition',
                      isCritical
                        ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30'
                        : 'hover:bg-muted/20',
                    )}
                  >
                    <td className="px-4 py-2 text-muted-foreground text-xs sticky left-0 bg-inherit z-10">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2 font-medium sticky left-10 bg-inherit z-10 min-w-[160px]">
                      <div className="flex items-center gap-1.5">
                        {isCritical && <AlertTriangle className="size-3.5 text-red-500 shrink-0" />}
                        <span className="truncate" title={formatStudentFullName(student)}>
                          {formatStudentFullName(student)}
                        </span>
                      </div>
                    </td>
                    {months.map((month, monthIdx) => {
                      const stats = month.stats[student.id];
                      const color = MONTH_COLORS[monthIdx % MONTH_COLORS.length]!;
                      const isExpanded = expandedMonth === month.month;
                      return (
                        <td
                          key={month.month}
                          className={cn(
                            'px-2 py-2 text-center cursor-pointer transition hover:opacity-80',
                            color.bg,
                            isExpanded && 'ring-2 ring-primary ring-inset',
                          )}
                          onClick={() => toggleMonth(month.month)}
                        >
                          <span
                            className={cn(
                              'inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                              stats?.rate == null
                                ? 'bg-muted text-muted-foreground'
                                : stats.rate >= 0.9
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : stats.rate >= CRITICAL_THRESHOLD
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                            )}
                          >
                            {stats?.rate != null ? `${(stats.rate * 100).toFixed(0)}%` : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right">
                      <RateBadge rate={student.rate} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 border-t border-border bg-muted/20 no-print">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="size-3 shrink-0" />% = (Presentes + Atrasos) * 100 / Total
            clases. Haz clic en un mes para ver el detalle.
          </p>
        </div>

        {/* Print-only footer */}
        <div className="print-only print-footer">
          % = (Presentes + Atrasos) * 100 / Total clases · Documento generado desde plataforma
          Asistencia CSSP — {new Date().toLocaleDateString('es-CL')}
        </div>

        {/* Print-only signatures */}
        <div className="print-only print-signatures" style={{ display: 'none' }}>
          <div>
            <hr />
            Profesor Jefe
          </div>
          <div>
            <hr />
            Inspectoría
          </div>
          <div>
            <hr />
            Dirección
          </div>
        </div>
      </div>

      {expandedMonth !== null && (
        <MonthDetail
          courseId={courseId}
          courseName={courseName}
          month={expandedMonth}
          year={months.find((m) => m.month === expandedMonth)?.year ?? new Date().getFullYear()}
          monthName={MONTH_NAMES[expandedMonth - 1] ?? ''}
        />
      )}
    </div>
  );
}

function MonthDetail({
  courseId,
  courseName,
  month,
  year,
  monthName,
}: {
  courseId: string;
  courseName: string;
  month: number;
  year: number;
  monthName: string;
}) {
  const [review, setReview] = useState<StatusReviewRequest | null>(null);
  const { data: matrix, isLoading } = useQuery<MatrixData>({
    queryKey: ['course-matrix-report', courseId, year, month],
    queryFn: () => api.get(`/attendance/course/${courseId}/matrix?year=${year}&month=${month}`),
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-background p-6 text-center">
        <div className="h-4 w-24 animate-pulse bg-muted rounded mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Cargando detalle…</p>
      </div>
    );
  }

  if (!matrix || matrix.students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">Sin datos para {monthName}</p>
      </div>
    );
  }

  const { students, dates, matrix: matrixData } = matrix;
  const openCellReview = (student: MatrixStudent, status: ReviewableAttendanceStatus) => {
    setReview({
      courseId,
      courseName,
      studentId: student.id,
      studentName: formatStudentFullName(student),
      status,
      periodLabel: `${monthName} ${year}`,
      months: [{ year, month }],
      initialMatrix: matrix,
    });
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-primary/5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CalendarDays className="size-4" />
            Detalle de {monthName} {year}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-3 py-2 sticky left-0 bg-muted/30 z-10 min-w-[140px]">
                  Alumno
                </th>
                {dates.map((date) => {
                  const day = new Date(date + 'T12:00').getDate();
                  return (
                    <th key={date} className="px-1 py-2 text-center min-w-[26px]">
                      {day}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id} className="border-t border-border/50">
                  <td className="px-3 py-1.5 sticky left-0 bg-background z-10 truncate max-w-[140px]">
                    {formatStudentFullName(student)}
                  </td>
                  {dates.map((date) => {
                    const status = matrixData[student.id]?.[date];
                    const reviewable = isReviewableStatus(status);
                    return (
                      <td key={date} className="px-1 py-1.5 text-center">
                        <span
                          onClick={() => {
                            if (!reviewable) return;
                            openCellReview(student, status);
                          }}
                          title={
                            reviewable
                              ? `Ver ${STATUS_REVIEW_LABELS[status].label.toLowerCase()}`
                              : undefined
                          }
                          className={cn(
                            'inline-block size-5 rounded text-[10px] leading-5 font-medium',
                            reviewable && 'cursor-pointer hover:ring-2 hover:ring-primary/30',
                            status === 'PRESENT' &&
                              'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                            status === 'ABSENT' &&
                              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                            status === 'LATE' &&
                              'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
                            status === 'JUSTIFIED' &&
                              'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
                            status === 'WITHDRAWN' &&
                              'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
                            !status && 'text-muted-foreground/30',
                          )}
                        >
                          {status === 'PRESENT'
                            ? 'P'
                            : status === 'ABSENT'
                              ? 'A'
                              : status === 'LATE'
                                ? 'AT'
                                : status === 'JUSTIFIED'
                                  ? 'J'
                                  : status === 'WITHDRAWN'
                                    ? 'R'
                                    : '·'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-border bg-muted/10 flex gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-green-100 dark:bg-green-900/30" />P
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-red-100 dark:bg-red-900/30" />A
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-orange-100 dark:bg-orange-900/30" />
            AT
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-yellow-100 dark:bg-yellow-900/30" />J
          </span>
        </div>
      </div>
      <StatusReviewModal request={review} onClose={() => setReview(null)} />
    </>
  );
}

function ExportButton({
  icon: Icon,
  label,
  sublabel,
  onClick,
  disabled,
  loading,
  variant = 'secondary',
}: {
  icon: typeof FileText;
  label: string;
  sublabel?: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-left transition disabled:opacity-50',
        variant === 'primary'
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border border-border hover:bg-muted',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{loading ? 'Generando…' : label}</p>
        {sublabel && <p className="text-[10px] opacity-70 truncate">{sublabel}</p>}
      </div>
    </button>
  );
}

function ExportarTab({
  courseId,
  studentId,
  students,
  setStudentId,
  year,
  month,
  semester,
  weekStart,
  setWeekStart,
  courseLabel,
  studentLabel,
  loading,
  download,
  downloadStudent,
  academicConfig,
}: {
  courseId: string;
  studentId: string;
  students: Student[] | undefined;
  setStudentId: (id: string) => void;
  year: number;
  month: number;
  semester: number;
  weekStart: string;
  setWeekStart: (date: string) => void;
  courseLabel: string;
  studentLabel: string;
  loading: string | null;
  download: (type: string, path: string, filename: string) => Promise<void>;
  downloadStudent: (type: string, path: string, filename: string) => Promise<void>;
  academicConfig: AcademicYearConfig | undefined;
}) {
  if (!courseId) {
    return (
      <EmptyState
        icon={Download}
        title="Selecciona un curso"
        description="Elige un curso para acceder a las opciones de exportación."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Reporte del Curso</h2>
            <p className="text-xs text-muted-foreground">Asistencia consolidada de {courseLabel}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Semanal
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
                  className="rounded-md border border-border p-1.5 hover:bg-muted transition"
                  title="Semana anterior"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span
                  className="flex-1 text-center text-xs font-medium truncate px-1"
                  title={formatWeekLabel(weekStart)}
                >
                  {formatWeekLabel(weekStart)}
                </span>
                <button
                  type="button"
                  onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
                  className="rounded-md border border-border p-1.5 hover:bg-muted transition"
                  title="Semana siguiente"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
              <ExportButton
                icon={FileSpreadsheet}
                label="Excel"
                sublabel={formatWeekLabel(weekStart)}
                onClick={() =>
                  download(
                    'weekly',
                    `/reports/course/${courseId}/weekly?weekStart=${weekStart}`,
                    `semana-${weekStart}-${courseLabel}.xlsx`,
                  )
                }
                loading={loading === 'weekly'}
                variant="primary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Mensual
            </h3>
            <ExportButton
              icon={FileSpreadsheet}
              label="Excel"
              sublabel={`${MONTH_NAMES[month - 1]} ${year}`}
              onClick={() =>
                download(
                  'month-xlsx',
                  `/reports/course/${courseId}/excel?year=${year}&month=${month}`,
                  `asistencia-${year}-${String(month).padStart(2, '0')}-${courseLabel}.xlsx`,
                )
              }
              loading={loading === 'month-xlsx'}
              variant="primary"
            />
            <ExportButton
              icon={FileText}
              label="PDF Resumen"
              sublabel={`${MONTH_NAMES[month - 1]} ${year}`}
              onClick={() =>
                download(
                  'month-pdf',
                  `/reports/course/${courseId}/pdf?year=${year}&month=${month}`,
                  `informe-${year}-${String(month).padStart(2, '0')}-${courseLabel}.pdf`,
                )
              }
              loading={loading === 'month-pdf'}
            />
            <ExportButton
              icon={FileText}
              label="PDF MINEDUC"
              sublabel="Lista oficial día×alumno"
              onClick={() =>
                download(
                  'month-grid-pdf',
                  `/reports/course/${courseId}/monthly-grid-pdf?year=${year}&month=${month}`,
                  `lista-mensual-${year}-${String(month).padStart(2, '0')}-${courseLabel}.pdf`,
                )
              }
              loading={loading === 'month-grid-pdf'}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Semestral
            </h3>
            {academicConfig && (
              <p className="text-[10px] text-muted-foreground">
                {semester === 1
                  ? formatDateRange(
                      academicConfig.firstSemester.startDate,
                      academicConfig.firstSemester.endDate,
                    )
                  : formatDateRange(
                      academicConfig.secondSemester.startDate,
                      academicConfig.secondSemester.endDate,
                    )}
              </p>
            )}
            <ExportButton
              icon={FileSpreadsheet}
              label="Excel"
              sublabel={`${semester === 1 ? '1er' : '2do'} Semestre ${year}`}
              onClick={() =>
                download(
                  'sem-xlsx',
                  `/reports/course/${courseId}/semester?year=${year}&semester=${semester}`,
                  `semestre${semester}-${year}-${courseLabel}.xlsx`,
                )
              }
              loading={loading === 'sem-xlsx'}
              variant="primary"
            />
            <ExportButton
              icon={FileText}
              label="PDF"
              sublabel={`${semester === 1 ? '1er' : '2do'} Semestre ${year}`}
              onClick={() =>
                download(
                  'sem-pdf',
                  `/reports/course/${courseId}/semester/pdf?year=${year}&semester=${semester}`,
                  `semestre${semester}-${year}-${courseLabel}.pdf`,
                )
              }
              loading={loading === 'sem-pdf'}
            />
            <ExportButton
              icon={FileText}
              label="PDF MINEDUC"
              sublabel="Lista oficial día×alumno"
              onClick={() =>
                download(
                  'sem-grid-pdf',
                  `/reports/course/${courseId}/semester-grid-pdf?year=${year}&semester=${semester}`,
                  `lista-semestral-sem${semester}-${year}-${courseLabel}.pdf`,
                )
              }
              loading={loading === 'sem-grid-pdf'}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Anual
            </h3>
            {academicConfig && (
              <p className="text-[10px] text-muted-foreground">
                {formatAnnualRanges(academicConfig.annual.ranges)}
              </p>
            )}
            <ExportButton
              icon={FileSpreadsheet}
              label="Excel"
              sublabel={`Año ${year}`}
              onClick={() =>
                download(
                  'annual-xlsx',
                  `/reports/course/${courseId}/annual?year=${year}`,
                  `anual-${year}-${courseLabel}.xlsx`,
                )
              }
              loading={loading === 'annual-xlsx'}
              variant="primary"
            />
            <ExportButton
              icon={FileText}
              label="PDF"
              sublabel={`Año ${year}`}
              onClick={() =>
                download(
                  'annual-pdf',
                  `/reports/course/${courseId}/annual/pdf?year=${year}`,
                  `anual-${year}-${courseLabel}.pdf`,
                )
              }
              loading={loading === 'annual-pdf'}
            />
            <ExportButton
              icon={FileText}
              label="PDF MINEDUC"
              sublabel="Lista oficial día×alumno"
              onClick={() =>
                download(
                  'annual-grid-pdf',
                  `/reports/course/${courseId}/annual-grid-pdf?year=${year}`,
                  `lista-anual-${year}-${courseLabel}.pdf`,
                )
              }
              loading={loading === 'annual-grid-pdf'}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-4 space-y-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Reporte Individual</h2>
            <p className="text-xs text-muted-foreground">
              Certificado formal con formato MINEDUC (Decreto 67/2018)
            </p>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Estudiante</label>
          <SearchableSelect
            options={
              students?.map((s) => ({
                value: s.id,
                label: `${s.lastName}${s.secondLastName ? ` ${s.secondLastName}` : ''}, ${s.firstName}`,
                sublabel: s.rut,
              })) ?? []
            }
            value={studentId}
            onChange={setStudentId}
            placeholder="— Selecciona un estudiante —"
            searchPlaceholder="Buscar por nombre o RUT…"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Mensual
            </h3>
            <ExportButton
              icon={FileText}
              label="PDF"
              sublabel={`${MONTH_NAMES[month - 1]} ${year}`}
              onClick={() =>
                downloadStudent(
                  'student-month-pdf',
                  `/reports/student/${studentId}/pdf?year=${year}&month=${month}`,
                  `certificado-asistencia-${year}-${String(month).padStart(2, '0')}-${studentLabel}.pdf`,
                )
              }
              disabled={!studentId}
              loading={loading === 'student-month-pdf'}
              variant="primary"
            />
            <ExportButton
              icon={FileSpreadsheet}
              label="Excel"
              sublabel={`${MONTH_NAMES[month - 1]} ${year}`}
              onClick={() =>
                downloadStudent(
                  'student-month-xlsx',
                  `/reports/student/${studentId}/excel?year=${year}&month=${month}`,
                  `asistencia-individual-${year}-${String(month).padStart(2, '0')}-${studentLabel}.xlsx`,
                )
              }
              disabled={!studentId}
              loading={loading === 'student-month-xlsx'}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Semestral
            </h3>
            <ExportButton
              icon={FileText}
              label="PDF"
              sublabel={`${semester === 1 ? '1er' : '2do'} Semestre ${year}`}
              onClick={() =>
                downloadStudent(
                  'student-sem-pdf',
                  `/reports/student/${studentId}/semester/pdf?year=${year}&semester=${semester}`,
                  `certificado-asistencia-sem${semester}-${year}-${studentLabel}.pdf`,
                )
              }
              disabled={!studentId}
              loading={loading === 'student-sem-pdf'}
              variant="primary"
            />
            <ExportButton
              icon={FileSpreadsheet}
              label="Excel"
              sublabel={`${semester === 1 ? '1er' : '2do'} Semestre ${year}`}
              onClick={() =>
                downloadStudent(
                  'student-sem-xlsx',
                  `/reports/student/${studentId}/semester/excel?year=${year}&semester=${semester}`,
                  `asistencia-individual-sem${semester}-${year}-${studentLabel}.xlsx`,
                )
              }
              disabled={!studentId}
              loading={loading === 'student-sem-xlsx'}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Anual
            </h3>
            <ExportButton
              icon={FileText}
              label="PDF"
              sublabel={`Año ${year}`}
              onClick={() =>
                downloadStudent(
                  'student-annual-pdf',
                  `/reports/student/${studentId}/annual/pdf?year=${year}`,
                  `certificado-asistencia-anual-${year}-${studentLabel}.pdf`,
                )
              }
              disabled={!studentId}
              loading={loading === 'student-annual-pdf'}
              variant="primary"
            />
            <ExportButton
              icon={FileSpreadsheet}
              label="Excel"
              sublabel={`Año ${year}`}
              onClick={() =>
                downloadStudent(
                  'student-annual-xlsx',
                  `/reports/student/${studentId}/annual/excel?year=${year}`,
                  `asistencia-individual-anual-${year}-${studentLabel}.xlsx`,
                )
              }
              disabled={!studentId}
              loading={loading === 'student-annual-xlsx'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDateRange(from: string, to: string): string {
  return `${formatShortDate(from)} a ${formatShortDate(to)}`;
}

function formatAnnualRanges(ranges: AcademicYearConfig['annual']['ranges']): string {
  return ranges.map((range) => formatDateRange(range.startDate, range.endDate)).join(' · ');
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${value}T12:00:00`));
}
