import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Users,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { api, downloadBlob } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatStudentFullName } from '@/lib/student-name';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { EmptyState } from '@/components/ui/EmptyState';
import { useEffectiveSchoolId } from '@/stores/school.store';

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
  total: number;
  present: number;
  absent: number;
  justified: number;
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
  rate: number | null;
};

type SummaryData = {
  students: SummaryStudent[];
  period: { from: string; to: string };
};

type MatrixData = {
  students: MatrixStudent[];
  dates: string[];
  matrix: Record<string, Record<string, string>>;
};

const JUNE_LAST_DAY = 18;
const CRITICAL_THRESHOLD = 0.85;

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

type Tab = 'resumen' | 'exportar';
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
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toISOString().split('T')[0]!;
  });
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

  const { data: matrix, isLoading: matrixLoading } = useQuery<MatrixData>({
    queryKey: ['course-matrix-report', courseId, year, month],
    queryFn: () => api.get(`/attendance/course/${courseId}/matrix?year=${year}&month=${month}`),
    enabled: !!courseId && periodType === 'mensual',
  });

  const summaryRange = useMemo(() => {
    if (periodType === 'semestral') {
      const from = semester === 1 ? `${year}-01-01` : `${year}-07-01`;
      const to = semester === 1 ? `${year}-06-30` : `${year}-12-31`;
      return { from, to };
    }
    if (periodType === 'anual') {
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    return null;
  }, [periodType, year, semester]);

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryData>({
    queryKey: ['course-summary-report', courseId, summaryRange?.from, summaryRange?.to],
    queryFn: () =>
      api.get(
        `/attendance/course/${courseId}/summary?from=${summaryRange!.from}&to=${summaryRange!.to}`,
      ),
    enabled: !!courseId && !!summaryRange,
  });

  const filteredDates = useMemo(() => {
    if (!matrix?.dates) return [];
    if (month !== 6) return matrix.dates;
    return matrix.dates.filter((d) => {
      const day = new Date(d + 'T12:00').getDate();
      return day <= JUNE_LAST_DAY;
    });
  }, [matrix?.dates, month]);

  const recalculatedStudents = useMemo(() => {
    if (!matrix?.students || !matrix.matrix || filteredDates.length === 0) return [];
    const dateSet = new Set(filteredDates);
    return matrix.students.map((s) => {
      const records = matrix.matrix[s.id];
      if (!records)
        return { ...s, total: 0, present: 0, absent: 0, justified: 0, late: 0, rate: null };
      let total = 0;
      let present = 0;
      let absent = 0;
      let late = 0;
      let justified = 0;
      for (const [dateKey, status] of Object.entries(records)) {
        if (!dateSet.has(dateKey)) continue;
        if (status === 'WITHDRAWN') continue;
        total++;
        if (status === 'PRESENT') present++;
        else if (status === 'ABSENT') absent++;
        else if (status === 'LATE') {
          late++;
          present++;
        } else if (status === 'JUSTIFIED') {
          justified++;
          present++;
        }
      }
      const rate = total > 0 ? present / total : null;
      return { ...s, total, present, absent, justified, late, rate };
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

  const tabs: { id: Tab; label: string; Icon: typeof Users }[] = [
    { id: 'resumen', label: 'Resumen', Icon: Users },
    { id: 'exportar', label: 'Exportar', Icon: Download },
  ];

  return (
    <div className="max-w-5xl space-y-5 overflow-hidden">
      <div>
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
          <div className="rounded-xl border border-border bg-background p-4 space-y-4">
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

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
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
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Período</label>
                <select
                  value={periodType}
                  onChange={(e) => setPeriodType(e.target.value as PeriodType)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                >
                  <option value="mensual">Mensual</option>
                  <option value="semestral">Semestral</option>
                  <option value="anual">Anual</option>
                </select>
              </div>
              {periodType === 'mensual' && (
                <div>
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
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Semestre</label>
                  <select
                    value={semester}
                    onChange={(e) => setSemester(Number(e.target.value))}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  >
                    <option value={1}>1er Semestre (Ene–Jun)</option>
                    <option value={2}>2do Semestre (Jul–Dic)</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-border">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition whitespace-nowrap',
                  tab === id
                    ? 'border-primary text-primary'
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
              periodType={periodType}
              month={month}
              year={year}
              semester={semester}
              matrixLoading={matrixLoading}
              summaryLoading={summaryLoading}
              sortedStudents={sortedStudents}
              sortedSummaryStudents={sortedSummaryStudents}
              avgRate={avgRate}
              avgSummaryRate={avgSummaryRate}
              belowCritical={belowCritical}
              belowSummaryCritical={belowSummaryCritical}
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
            />
          )}
        </>
      )}
    </div>
  );
}

function ResumenTab({
  courseId,
  periodType,
  month,
  year,
  semester,
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
  periodType: PeriodType;
  month: number;
  year: number;
  semester: number;
  matrixLoading: boolean;
  summaryLoading: boolean;
  sortedStudents: (MatrixStudent & { late: number })[];
  sortedSummaryStudents: SummaryStudent[];
  avgRate: number | null;
  avgSummaryRate: number | null;
  belowCritical: number;
  belowSummaryCritical: number;
}) {
  if (!courseId) {
    return (
      <EmptyState
        icon={Users}
        title="Selecciona un curso"
        description="Elige un curso para ver el resumen de asistencia."
      />
    );
  }

  const isMonthly = periodType === 'mensual';
  const isLoading = isMonthly ? matrixLoading : summaryLoading;
  const students = isMonthly ? sortedStudents : sortedSummaryStudents;
  const avg = isMonthly ? avgRate : avgSummaryRate;
  const below = isMonthly ? belowCritical : belowSummaryCritical;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-background p-10 text-center">
        <div className="h-6 w-32 animate-pulse bg-muted rounded mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Cargando datos…</p>
      </div>
    );
  }

  if (students.length === 0) {
    const periodLabel = isMonthly
      ? `${MONTH_NAMES[month - 1]} ${year}`
      : periodType === 'semestral'
        ? `${semester === 1 ? '1er' : '2do'} Semestre ${year}`
        : `Año ${year}`;
    return (
      <div className="rounded-xl border border-border bg-background p-10 text-center">
        <Users className="size-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          Sin registros para {periodLabel}
        </p>
      </div>
    );
  }

  const periodLabel = isMonthly
    ? `${MONTH_NAMES[month - 1]} ${year}`
    : periodType === 'semestral'
      ? `${semester === 1 ? '1er' : '2do'} Semestre ${year}`
      : `Año ${year}`;

  const showJuneBanner = isMonthly && month === 6;
  const showIncompleteBanner =
    !isMonthly &&
    sortedSummaryStudents.length > 0 &&
    sortedSummaryStudents.some((s) => s.total === 0);

  return (
    <div className="space-y-4">
      {showJuneBanner && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-amber-200 dark:bg-amber-800/50 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="size-4.5 text-amber-700 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Junio: período evaluado hasta el día {JUNE_LAST_DAY}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Último día de clases del mes. Los días posteriores no se incluyen en el cálculo.
              </p>
            </div>
          </div>
        </div>
      )}

      {showIncompleteBanner && (
        <div className="rounded-xl border border-blue-300 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-950/30 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-blue-200 dark:bg-blue-800/50 flex items-center justify-center flex-shrink-0">
              <CalendarDays className="size-4.5 text-blue-700 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                Período en curso
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-400">
                Datos disponibles hasta la última fecha con registro. Los meses sin asistencia no se
                incluyen en el cálculo.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            Asistencia promedio
          </p>
          <p
            className="text-2xl font-bold mt-1"
            style={{
              color:
                avg == null
                  ? '#94a3b8'
                  : avg >= 0.9
                    ? '#22c55e'
                    : avg >= CRITICAL_THRESHOLD
                      ? '#f59e0b'
                      : '#ef4444',
            }}
          >
            {avg != null ? `${(avg * 100).toFixed(1)}%` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            Bajo {CRITICAL_THRESHOLD * 100}%
          </p>
          <p
            className="text-2xl font-bold mt-1"
            style={{ color: below > 0 ? '#ef4444' : '#22c55e' }}
          >
            {below}
          </p>
          <p className="text-[10px] text-muted-foreground">alumnos críticos</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-4 col-span-2 sm:col-span-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
            Total alumnos
          </p>
          <p className="text-2xl font-bold mt-1">{students.length}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Users className="size-4" />
            Lista de asistencia — {periodLabel}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Alumnos bajo {CRITICAL_THRESHOLD * 100}% destacados en rojo
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <th className="text-left px-5 py-3">#</th>
                <th className="text-left px-5 py-3">Alumno</th>
                <th className="text-center px-3 py-3">Pres.</th>
                <th className="text-center px-3 py-3">Aus.</th>
                <th className="hidden sm:table-cell text-center px-3 py-3">Atrasos</th>
                <th className="hidden sm:table-cell text-center px-3 py-3">Justif.</th>
                <th className="text-right px-5 py-3">%</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const isCritical = s.rate != null && s.rate < CRITICAL_THRESHOLD;
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
                    <td className="px-5 py-2.5 text-muted-foreground text-xs">{i + 1}</td>
                    <td className="px-5 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        {isCritical && <AlertTriangle className="size-3.5 text-red-500 shrink-0" />}
                        <span className="truncate" title={formatStudentFullName(s)}>
                          {formatStudentFullName(s)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-green-600 dark:text-green-400">
                      {s.present}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-red-600 dark:text-red-400">
                      {s.absent}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2.5 text-center tabular-nums text-orange-600 dark:text-orange-400">
                      {s.late}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2.5 text-center tabular-nums text-yellow-600 dark:text-yellow-400">
                      {s.justified}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-semibold',
                          s.rate == null
                            ? 'bg-muted text-muted-foreground'
                            : s.rate >= 0.9
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : s.rate >= CRITICAL_THRESHOLD
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                        )}
                      >
                        {s.rate != null ? `${(s.rate * 100).toFixed(1)}%` : '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-border bg-muted/20 space-y-1">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="size-3 shrink-0" />
            Porcentaje calculado conforme al Decreto 67/2018 MINEDUC. Asistencia = (Presentes +
            Atrasos + Justificados) / Total días registrados.
          </p>
          {showJuneBanner && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="size-3 shrink-0" />
              Período evaluado: 1 al {JUNE_LAST_DAY} de junio (último día de clases).
            </p>
          )}
          {below > 0 && (
            <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
              <XCircle className="size-3 shrink-0" />
              {below} {below === 1 ? 'alumno bajo' : 'alumnos bajo'} {CRITICAL_THRESHOLD * 100}% —
              requiere atención prioritaria según normativa MINEDUC.
            </p>
          )}
        </div>
      </div>
    </div>
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
      <div className="rounded-xl border border-border bg-background p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <GraduationCap className="size-4" />
            Reporte Individual
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Certificado formal de asistencia con formato MINEDUC (Decreto 67/2018)
          </p>
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

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold">Mensual</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                downloadStudent(
                  'student-month-pdf',
                  `/reports/student/${studentId}/pdf?year=${year}&month=${month}`,
                  `certificado-asistencia-${year}-${String(month).padStart(2, '0')}-${studentLabel}.pdf`,
                )
              }
              disabled={loading === 'student-month-pdf' || !studentId}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <FileText className="size-4" />
              {loading === 'student-month-pdf' ? 'Generando…' : 'PDF'}
            </button>
            <button
              onClick={() =>
                downloadStudent(
                  'student-month-xlsx',
                  `/reports/student/${studentId}/excel?year=${year}&month=${month}`,
                  `asistencia-individual-${year}-${String(month).padStart(2, '0')}-${studentLabel}.xlsx`,
                )
              }
              disabled={loading === 'student-month-xlsx' || !studentId}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <FileSpreadsheet className="size-4" />
              {loading === 'student-month-xlsx' ? 'Generando…' : 'Excel'}
            </button>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold">Semestral</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                downloadStudent(
                  'student-sem-pdf',
                  `/reports/student/${studentId}/semester/pdf?year=${year}&semester=${semester}`,
                  `certificado-asistencia-sem${semester}-${year}-${studentLabel}.pdf`,
                )
              }
              disabled={loading === 'student-sem-pdf' || !studentId}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <FileText className="size-4" />
              {loading === 'student-sem-pdf' ? 'Generando…' : 'PDF'}
            </button>
            <button
              onClick={() =>
                downloadStudent(
                  'student-sem-xlsx',
                  `/reports/student/${studentId}/semester/excel?year=${year}&semester=${semester}`,
                  `asistencia-individual-sem${semester}-${year}-${studentLabel}.xlsx`,
                )
              }
              disabled={loading === 'student-sem-xlsx' || !studentId}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <FileSpreadsheet className="size-4" />
              {loading === 'student-sem-xlsx' ? 'Generando…' : 'Excel'}
            </button>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold">Anual</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                downloadStudent(
                  'student-annual-pdf',
                  `/reports/student/${studentId}/annual/pdf?year=${year}`,
                  `certificado-asistencia-anual-${year}-${studentLabel}.pdf`,
                )
              }
              disabled={loading === 'student-annual-pdf' || !studentId}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <FileText className="size-4" />
              {loading === 'student-annual-pdf' ? 'Generando…' : 'PDF'}
            </button>
            <button
              onClick={() =>
                downloadStudent(
                  'student-annual-xlsx',
                  `/reports/student/${studentId}/annual/excel?year=${year}`,
                  `asistencia-individual-anual-${year}-${studentLabel}.xlsx`,
                )
              }
              disabled={loading === 'student-annual-xlsx' || !studentId}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <FileSpreadsheet className="size-4" />
              {loading === 'student-annual-xlsx' ? 'Generando…' : 'Excel'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Users className="size-4" />
            Reporte del Curso
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Exporta la asistencia consolidada de todo el curso
          </p>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold">Semanal</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Semana desde (lunes)
              </label>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
              />
            </div>
            <button
              onClick={() =>
                download(
                  'weekly',
                  `/reports/course/${courseId}/weekly?weekStart=${weekStart}`,
                  `semana-${weekStart}-${courseLabel}.xlsx`,
                )
              }
              disabled={loading === 'weekly'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 mt-4"
            >
              <FileSpreadsheet className="size-4" />
              {loading === 'weekly' ? 'Generando…' : 'Excel semanal'}
            </button>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold">Mensual</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                download(
                  'month-xlsx',
                  `/reports/course/${courseId}/excel?year=${year}&month=${month}`,
                  `asistencia-${year}-${String(month).padStart(2, '0')}-${courseLabel}.xlsx`,
                )
              }
              disabled={loading === 'month-xlsx'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <FileSpreadsheet className="size-4" />
              {loading === 'month-xlsx' ? 'Generando…' : 'Excel'}
            </button>
            <button
              onClick={() =>
                download(
                  'month-pdf',
                  `/reports/course/${courseId}/pdf?year=${year}&month=${month}`,
                  `informe-${year}-${String(month).padStart(2, '0')}-${courseLabel}.pdf`,
                )
              }
              disabled={loading === 'month-pdf'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <FileText className="size-4" />
              {loading === 'month-pdf' ? 'Generando…' : 'PDF resumen'}
            </button>
            <button
              onClick={() =>
                download(
                  'month-grid-pdf',
                  `/reports/course/${courseId}/monthly-grid-pdf?year=${year}&month=${month}`,
                  `lista-mensual-${year}-${String(month).padStart(2, '0')}-${courseLabel}.pdf`,
                )
              }
              disabled={loading === 'month-grid-pdf'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
              title="Lista oficial estilo MINEDUC con grilla día×alumno (A4 horizontal)"
            >
              <FileText className="size-4" />
              {loading === 'month-grid-pdf' ? 'Generando…' : 'PDF MINEDUC'}
            </button>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold">Semestral</h3>
          <p className="text-xs text-muted-foreground">
            S1 = Ene–Jun · S2 = Jul–Dic. Excel incluye una hoja por mes + resumen consolidado.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                download(
                  'sem-xlsx',
                  `/reports/course/${courseId}/semester?year=${year}&semester=${semester}`,
                  `semestre${semester}-${year}-${courseLabel}.xlsx`,
                )
              }
              disabled={loading === 'sem-xlsx'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <FileSpreadsheet className="size-4" />
              {loading === 'sem-xlsx' ? 'Generando…' : 'Excel semestral'}
            </button>
            <button
              onClick={() =>
                download(
                  'sem-pdf',
                  `/reports/course/${courseId}/semester/pdf?year=${year}&semester=${semester}`,
                  `semestre${semester}-${year}-${courseLabel}.pdf`,
                )
              }
              disabled={loading === 'sem-pdf'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <FileText className="size-4" />
              {loading === 'sem-pdf' ? 'Generando…' : 'PDF semestral'}
            </button>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold">Anual</h3>
          <p className="text-xs text-muted-foreground">
            Incluye Enero–Diciembre con resumen consolidado del curso.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                download(
                  'annual-xlsx',
                  `/reports/course/${courseId}/annual?year=${year}`,
                  `anual-${year}-${courseLabel}.xlsx`,
                )
              }
              disabled={loading === 'annual-xlsx'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <FileSpreadsheet className="size-4" />
              {loading === 'annual-xlsx' ? 'Generando…' : 'Excel anual'}
            </button>
            <button
              onClick={() =>
                download(
                  'annual-pdf',
                  `/reports/course/${courseId}/annual/pdf?year=${year}`,
                  `anual-${year}-${courseLabel}.pdf`,
                )
              }
              disabled={loading === 'annual-pdf'}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <FileText className="size-4" />
              {loading === 'annual-pdf' ? 'Generando…' : 'PDF anual'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
