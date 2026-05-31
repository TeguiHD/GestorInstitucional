import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  Download,
  FileText,
  Upload,
  BookOpen,
  CheckSquare,
  BarChart3,
  Info,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { useUser } from '@/stores/auth.store';
import { api, downloadBlob } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatStudentFullName } from '@/lib/student-name';
import { CourseStatsTab } from './components/CourseStatsTab';
import { StudentsTab } from './components/StudentsTab';
import { JustificationsTab } from './components/JustificationsTab';
import { MonthlyAttendanceGrid } from './components/MonthlyAttendanceGrid';

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  enrollmentNumber: number;
  rut: string;
  enrolledAt?: string | undefined;
  withdrawnAt?: string | null | undefined;
};
type Insight = {
  type: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
};
type CourseInsights = { period: string; attendanceRate: number; insights: Insight[] };
type Course = {
  id: string;
  name: string;
  code: string;
  level: string;
  year: number;
  schoolId: string;
  students: Student[];
  teachers: {
    user: { id: string; firstName: string; lastName: string; email: string };
    isHead: boolean;
  }[];
};

type ImportRow = {
  rut: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | undefined;
  birthDate?: string | undefined;
  enrolledAt?: string | undefined;
  enrollmentNumber: number;
};

type Tab = 'asistencia' | 'alumnos' | 'justificaciones' | 'estadisticas';

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'asistencia', label: 'Asistencia', icon: CheckSquare },
  { id: 'alumnos', label: 'Alumnos', icon: FileText },
  { id: 'justificaciones', label: 'Justificaciones', icon: FileText },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3 },
];

function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  const delimiter = text.includes(';') ? ';' : text.includes('\t') ? '\t' : ',';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeRut(raw: string): string {
  return raw.replace(/\./g, '').replace(/\s/g, '').toUpperCase();
}

export function CourseDetailPage() {
  const { courseId } = useParams({ from: '/_auth/cursos/$courseId' });
  const qc = useQueryClient();
  const user = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ImportRow[] | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('asistencia');

  const { data: course } = useQuery<Course>({
    queryKey: ['course', courseId],
    queryFn: () => api.get(`/courses/${courseId}`),
  });

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const { data: insights } = useQuery<CourseInsights>({
    queryKey: ['course-insights', courseId, year, month],
    queryFn: () => api.get(`/insights/course/${courseId}?year=${year}&month=${month}`),
  });

  const importMutation = useMutation({
    mutationFn: (rows: ImportRow[]) =>
      api.post<{
        total: number;
        created: number;
        skipped: number;
        errors: Array<{ row: number; rut: string; reason: string }>;
      }>('/students/import', { schoolId: user?.schoolId, courseId, rows }),
    onSuccess: (res) => {
      toast.success(`${res.created} alumno${res.created !== 1 ? 's' : ''} importados`, {
        description: res.skipped ? `${res.skipped} omitidos.` : `Total: ${res.total}`,
      });
      if (res.errors.length > 0) console.table(res.errors);
      setImportPreview(null);
      void qc.invalidateQueries({ queryKey: ['course', courseId] });
      void qc.invalidateQueries({ queryKey: ['course-students', courseId] });
    },
    onError: (e: unknown) => toast.error(`Error al importar: ${(e as Error).message}`),
  });

  const handleFilePick = async (file: File) => {
    try {
      if (file.size > 1024 * 1024) {
        toast.error('El archivo CSV supera 1 MB.');
        return;
      }

      const rows = parseDelimited(await file.text());
      const header = rows[0]?.map((cell) => cell.toLowerCase().trim()) ?? [];
      const indexOf = (...names: string[]) =>
        header.findIndex((cell) => names.some((name) => cell === name || cell.includes(name)));

      const rutIdx = indexOf('rut', 'run');
      const firstNameIdx = indexOf('firstname', 'first_name', 'nombres', 'nombre');
      const lastNameIdx = indexOf('lastname', 'last_name', 'apellido paterno', 'apellido');
      const secondLastNameIdx = indexOf('secondlastname', 'second_last_name', 'apellido materno');
      const birthDateIdx = indexOf('birthdate', 'fecha de nacimiento', 'fecha nacimiento');
      const enrolledAtIdx = indexOf(
        'enrolledat',
        'fecha de ingreso',
        'fecha ingreso',
        'f. ingreso',
        'f ingreso',
      );
      const enrollmentIdx = indexOf('enrollmentnumber', 'n°', 'nº', 'numero', 'n lista');

      if (rutIdx === -1 || firstNameIdx === -1 || lastNameIdx === -1) {
        toast.error('CSV inválido. Columnas requeridas: rut, firstName, lastName.');
        return;
      }

      const normalized: ImportRow[] = rows
        .slice(1)
        .map((r, i) => {
          const enrollmentNumber =
            enrollmentIdx >= 0 && Number.isFinite(Number(r[enrollmentIdx]))
              ? Number(r[enrollmentIdx])
              : i + 1;
          return {
            rut: normalizeRut(r[rutIdx] ?? ''),
            firstName: (r[firstNameIdx] ?? '').trim(),
            lastName: (r[lastNameIdx] ?? '').trim(),
            secondLastName:
              secondLastNameIdx >= 0 ? (r[secondLastNameIdx] ?? '').trim() || undefined : undefined,
            birthDate: birthDateIdx >= 0 ? (r[birthDateIdx] ?? '').trim() || undefined : undefined,
            enrolledAt:
              enrolledAtIdx >= 0 ? (r[enrolledAtIdx] ?? '').trim() || undefined : undefined,
            enrollmentNumber,
          };
        })
        .filter((r) => r.rut && r.firstName && r.lastName);
      if (normalized.length === 0) {
        toast.error('Sin filas válidas.');
        return;
      }
      setImportPreview(normalized);
    } catch (e) {
      toast.error(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
  };

  const total = course?.students?.length ?? 0;
  const headTeacher = course?.teachers.find((t) => t.isHead) ?? course?.teachers[0];

  return (
    <div className="max-w-full space-y-0 -mt-3 sm:-mt-4 lg:-mt-6">
      {/* ── Header ─────────────────────────────────────── */}
      <div
        className="px-3 pt-6 pb-5 sm:px-4 lg:px-6 -mx-3 sm:-mx-4 lg:-mx-6 mb-4"
        style={{ background: 'linear-gradient(135deg, #008269 0%, #004d40 100%)' }}
      >
        {/* Breadcrumb */}
        <Link
          to="/cursos"
          className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-medium transition mb-4"
        >
          <ArrowLeft className="size-3.5" />
          Cursos
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="size-9 rounded-lg bg-white/15 flex items-center justify-center">
                <BookOpen className="size-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white leading-tight">
                  {course?.name ?? '…'}
                </h1>
                <p className="text-white/70 text-sm">
                  {course?.code} · {course?.year} · {course?.level}
                  {headTeacher &&
                    ` · Prof. ${headTeacher.user.firstName} ${headTeacher.user.lastName}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <StatPill label={`${total} alumno${total !== 1 ? 's' : ''}`} />
              {insights && (
                <StatPill
                  label={`${(insights.attendanceRate * 100).toFixed(1)}% asistencia`}
                  warn={insights.attendanceRate < 0.7}
                />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex shrink-0 items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
            >
              <Upload className="size-3.5" />
              Importar
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFilePick(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() =>
                void downloadBlob(
                  `/reports/course/${courseId}/excel?year=${year}&month=${month}`,
                  `asistencia-${year}-${String(month).padStart(2, '0')}.xlsx`,
                ).catch((e: Error) => toast.error(e.message))
              }
              className="flex shrink-0 items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
            >
              <Download className="size-3.5" />
              Excel
            </button>
            <button
              type="button"
              onClick={() =>
                void downloadBlob(
                  `/reports/course/${courseId}/pdf?year=${year}&month=${month}`,
                  `informe-${year}-${String(month).padStart(2, '0')}.pdf`,
                ).catch((e: Error) => toast.error(e.message))
              }
              className="flex shrink-0 items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
            >
              <FileText className="size-3.5" />
              PDF
            </button>
          </div>
        </div>

        {/* Tab bar — inside header */}
        <div className="mt-5 -mb-5 overflow-x-auto border-b border-white/20">
          <div className="flex min-w-max items-center gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px whitespace-nowrap',
                  activeTab === id
                    ? 'border-white text-white'
                    : 'border-transparent text-white/60 hover:text-white/90',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────── */}

      {/* ALUMNOS */}
      {activeTab === 'alumnos' && <StudentsTab courseId={courseId} />}

      {/* JUSTIFICACIONES */}
      {activeTab === 'justificaciones' && (
        <JustificationsTab courseId={courseId} students={course?.students ?? []} />
      )}

      {/* ESTADÍSTICAS */}
      {activeTab === 'estadisticas' && <CourseStatsTab courseId={courseId} />}

      {/* ASISTENCIA */}
      {activeTab === 'asistencia' && (
        <div className="space-y-5">
          {/* Import preview */}
          {importPreview && (
            <div className="rounded-xl border border-border bg-background p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Previsualización — {importPreview.length} filas
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setImportPreview(null)}
                    className="text-xs px-3 py-1.5 rounded-lg border hover:bg-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => importMutation.mutate(importPreview)}
                    disabled={importMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    {importMutation.isPending ? 'Importando…' : 'Confirmar'}
                  </button>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto text-xs">
                <div className="data-scroll data-scroll-sm">
                  <table className="w-full">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5">N°</th>
                        <th className="text-left px-2 py-1.5">RUT</th>
                        <th className="text-left px-2 py-1.5">Alumno</th>
                        <th className="text-left px-2 py-1.5">F. Ingreso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.slice(0, 30).map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2 py-1">{r.enrollmentNumber}</td>
                          <td className="px-2 py-1 font-mono">{r.rut}</td>
                          <td className="px-2 py-1">{formatStudentFullName(r)}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {r.enrolledAt ?? 'Hoy'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importPreview.length > 30 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    …y {importPreview.length - 30} más
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Monthly attendance grid */}
          <MonthlyAttendanceGrid courseId={courseId} />

          {/* Insights */}
          {insights && insights.insights.length > 0 && (
            <div className="rounded-xl border border-border bg-background p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Análisis automático · {insights.period}</h2>
                <span className="text-xs text-muted-foreground">
                  {(insights.attendanceRate * 100).toFixed(1)}% asistencia
                </span>
              </div>
              <div className="space-y-2">
                {insights.insights.map((ins, i) => {
                  const styles = {
                    info: 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400',
                    warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
                    critical: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400',
                  }[ins.severity];
                  const Icon =
                    ins.severity === 'info'
                      ? Info
                      : ins.severity === 'warn'
                        ? ShieldAlert
                        : XCircle;
                  return (
                    <div key={i} className={`rounded-lg border px-3 py-2 ${styles}`}>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Icon className="size-4 shrink-0" />
                        {ins.title}
                      </p>
                      <p className="text-xs mt-0.5 text-foreground/80">{ins.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, warn = false }: { label: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        warn ? 'bg-red-500/20 text-red-200' : 'bg-white/15 text-white/90',
      )}
    >
      {label}
    </span>
  );
}
