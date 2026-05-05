import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  QrCode,
  Upload,
  Users,
  BookOpen,
  CheckSquare,
  BarChart3,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useUser } from '@/stores/auth.store';
import { api, downloadBlob } from '@/lib/api';
import { attendanceQueue } from '@/lib/attendance-queue';
import { useAttendanceSync } from '@/hooks/useAttendanceSync';
import { cn } from '@/lib/cn';
import { QrScanner } from './components/QrScanner';
import { CourseStatsTab } from './components/CourseStatsTab';
import { StudentsTab } from './components/StudentsTab';
import { JustificationsTab } from './components/JustificationsTab';

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  enrollmentNumber: number;
  rut: string;
};
type AttendanceEntry = { studentId: string; status: StatusKey; note?: string };
type AttendanceRecord = { student: Student; status: string; note?: string; id: string };
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

type StatusKey = 'PRESENT' | 'ABSENT' | 'LATE' | 'JUSTIFIED';
type StatusConfig = { label: string; bg: string; text: string; short: string };

const STATUS_CONFIG: Record<StatusKey, StatusConfig> = {
  PRESENT: {
    label: 'Presente',
    bg: 'bg-green-100  dark:bg-green-900/30',
    text: 'text-green-700  dark:text-green-400',
    short: 'P',
  },
  ABSENT: {
    label: 'Ausente',
    bg: 'bg-red-100    dark:bg-red-900/30',
    text: 'text-red-700    dark:text-red-400',
    short: 'A',
  },
  LATE: {
    label: 'Atraso',
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-400',
    short: 'AT',
  },
  JUSTIFIED: {
    label: 'Justificado',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-700 dark:text-yellow-400',
    short: 'J',
  },
};

const UNMARKED_CONFIG: StatusConfig = {
  label: 'Sin marcar',
  bg: 'bg-slate-100 dark:bg-slate-800',
  text: 'text-slate-600 dark:text-slate-300',
  short: '--',
};

const STATUS_CYCLE = ['PRESENT', 'ABSENT', 'LATE', 'JUSTIFIED'] as const;

type ImportRow = {
  rut: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | undefined;
  birthDate?: string | undefined;
  enrollmentNumber: number;
};

type Tab = 'asistencia' | 'alumnos' | 'justificaciones' | 'estadisticas';

const TABS: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'asistencia', label: 'Asistencia', icon: CheckSquare },
  { id: 'alumnos', label: 'Alumnos', icon: Users },
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

  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]!);
  const [localStatus, setLocalStatus] = useState<Record<string, StatusKey>>({});
  const [showQr, setShowQr] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const { online, pendingCount, refreshCount } = useAttendanceSync();

  const { data: course } = useQuery<Course>({
    queryKey: ['course', courseId],
    queryFn: () => api.get(`/courses/${courseId}`),
  });

  const { data: records, isLoading: recordsLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance', courseId, selectedDate],
    queryFn: () => api.get(`/attendance/course/${courseId}?date=${selectedDate}`),
    enabled: activeTab === 'asistencia',
  });

  const dateObj = new Date(selectedDate + 'T12:00:00');
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;

  const { data: insights } = useQuery<CourseInsights>({
    queryKey: ['course-insights', courseId, year, month],
    queryFn: () => api.get(`/insights/course/${courseId}?year=${year}&month=${month}`),
  });

  useEffect(() => {
    if (!records) return;
    const map: Record<string, StatusKey> = {};
    records.forEach((r) => {
      if (r.status in STATUS_CONFIG) map[r.student.id] = r.status as StatusKey;
    });
    setLocalStatus(map);
  }, [records]);

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

  const saveMutation = useMutation({
    mutationFn: (entries: AttendanceEntry[]) =>
      api.post('/attendance', { courseId, date: selectedDate, entries }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance', courseId, selectedDate] });
      const count = Object.keys(localStatus).length;
      toast.success('Asistencia guardada', {
        description: `${count} alumno${count !== 1 ? 's' : ''} — ${dateObj.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long' })}`,
      });
    },
    onError: (_err, entries) => {
      attendanceQueue.enqueue({ courseId, date: selectedDate, entries });
      refreshCount();
      toast.warning('Sin conexión — guardado localmente.', { duration: 5000 });
    },
  });

  const cycleStatus = (studentId: string) => {
    setLocalStatus((prev) => {
      const current = prev[studentId];
      const idx = current ? STATUS_CYCLE.indexOf(current) : -1;
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]!;
      return { ...prev, [studentId]: next };
    });
  };

  const startLongPress = (studentId: string) => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setSheetFor(studentId);
      if ('vibrate' in navigator) navigator.vibrate?.(40);
    }, 500);
  };

  const endLongPress = (studentId: string) => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!longPressFired.current) cycleStatus(studentId);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressFired.current = true;
  };

  const courseStudents = course?.students ?? [];
  const courseStatusValues = courseStudents
    .map((student) => localStatus[student.id])
    .filter((status): status is StatusKey => Boolean(status));

  const handleSave = () => {
    const entries = courseStudents
      .map((student) => {
        const status = localStatus[student.id];
        return status ? { studentId: student.id, status } : null;
      })
      .filter((entry): entry is AttendanceEntry => entry !== null);

    if (entries.length === 0) {
      toast.info('Sin cambios');
      return;
    }
    if (entries.length !== courseStudents.length) {
      const pending = courseStudents.length - entries.length;
      toast.warning(`Faltan ${pending} alumno${pending !== 1 ? 's' : ''} por marcar`);
      return;
    }
    saveMutation.mutate(entries);
  };

  const prevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split('T')[0]!);
    setLocalStatus({});
  };
  const nextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().split('T')[0]!);
    setLocalStatus({});
  };

  const presentCount = courseStatusValues.filter((s) => s === 'PRESENT' || s === 'LATE').length;
  const total = courseStudents.length;
  const markedCount = courseStatusValues.length;
  const pendingStudents = Math.max(total - markedCount, 0);
  const completionRate = total > 0 ? markedCount / total : 0;
  const attendanceRate = markedCount > 0 ? presentCount / markedCount : 0;
  const canSaveAttendance = total > 0 && pendingStudents === 0 && !saveMutation.isPending;

  const headTeacher = course?.teachers.find((t) => t.isHead) ?? course?.teachers[0];

  return (
    <div className="space-y-0 -mt-4 lg:-mt-6">
      {/* ── Header ─────────────────────────────────────── */}
      <div
        className="px-4 pt-6 pb-5 lg:px-6 -mx-4 lg:-mx-6 mb-5"
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
          <div>
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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
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
              onClick={() => setShowQr(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
            >
              <QrCode className="size-3.5" />
              QR
            </button>
            <button
              type="button"
              onClick={() =>
                void downloadBlob(
                  `/reports/course/${courseId}/excel?year=${year}&month=${month}`,
                  `asistencia-${year}-${String(month).padStart(2, '0')}.xlsx`,
                ).catch((e: Error) => toast.error(e.message))
              }
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
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
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
            >
              <FileText className="size-3.5" />
              PDF
            </button>
          </div>
        </div>

        {/* Tab bar — inside header */}
        <div className="flex items-center gap-1 mt-5 -mb-5 border-b border-white/20">
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
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5">N°</th>
                      <th className="text-left px-2 py-1.5">RUT</th>
                      <th className="text-left px-2 py-1.5">Alumno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.slice(0, 30).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1">{r.enrollmentNumber}</td>
                        <td className="px-2 py-1 font-mono">{r.rut}</td>
                        <td className="px-2 py-1">
                          {r.lastName} {r.secondLastName ?? ''}, {r.firstName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.length > 30 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    …y {importPreview.length - 30} más
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Date nav */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={prevDay}
              className="size-8 rounded-lg border flex items-center justify-center hover:bg-muted transition"
            >
              <ChevronLeft className="size-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setLocalStatus({});
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
            />
            <button
              onClick={nextDay}
              className="size-8 rounded-lg border flex items-center justify-center hover:bg-muted transition"
            >
              <ChevronRight className="size-4" />
            </button>
            <span className="text-sm text-muted-foreground capitalize">
              {dateObj.toLocaleDateString('es-CL', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </span>
          </div>

          {/* Progress bar */}
          <div className="rounded-xl border border-border bg-background p-4 space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${completionRate * 100}%` }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {markedCount}/{total}
              </span>
              <span className="text-sm text-muted-foreground">
                {(completionRate * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-green-100 px-2.5 py-1 font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {presentCount} presentes
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {pendingStudents} sin marcar
              </span>
              <span className="text-muted-foreground">
                {(attendanceRate * 100).toFixed(0)}% asistencia marcada
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Registro individual obligatorio. La asistencia se guarda cuando todos los alumnos
              tienen estado.
            </span>
          </div>

          {/* Student list */}
          <div className="rounded-xl border border-border bg-background overflow-hidden">
            {recordsLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse bg-muted rounded-lg" />
                ))}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-3 w-10">#</th>
                    <th className="text-left px-4 py-3">Alumno</th>
                    <th className="text-center px-4 py-3 w-28">Estado</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {courseStudents.map((student) => {
                    const status = localStatus[student.id];
                    const cfg = status ? STATUS_CONFIG[status] : UNMARKED_CONFIG;
                    return (
                      <tr
                        key={student.id}
                        className="border-t border-border hover:bg-muted/20 transition"
                      >
                        <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">
                          {student.enrollmentNumber}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <Link
                            to="/alumnos/$studentId"
                            params={{ studentId: student.id }}
                            search={{ courseId }}
                            className="hover:text-primary hover:underline underline-offset-2 transition-colors"
                          >
                            {student.lastName}, {student.firstName}
                          </Link>
                          <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
                            {student.rut}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onPointerDown={() => startLongPress(student.id)}
                            onPointerUp={() => endLongPress(student.id)}
                            onPointerLeave={cancelLongPress}
                            onPointerCancel={cancelLongPress}
                            onContextMenu={(e) => e.preventDefault()}
                            className={cn(
                              'inline-flex min-h-[44px] w-24 select-none items-center justify-center rounded-lg text-xs font-semibold transition-all hover:opacity-90 active:scale-95 touch-none',
                              cfg.bg,
                              cfg.text,
                            )}
                            title="Cambiar estado"
                          >
                            <span className="hidden sm:inline">{cfg.label}</span>
                            <span className="sm:hidden text-sm">{cfg.short}</span>
                          </button>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              void downloadBlob(
                                `/students/${student.id}/qr`,
                                `qr-${student.rut}.png`,
                              ).catch((e: Error) => toast.error(e.message))
                            }
                            className="inline-flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition"
                            title="Descargar QR"
                          >
                            <QrCode className="size-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

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
                  const icon = { info: 'ℹ', warn: '⚠', critical: '⛔' }[ins.severity];
                  return (
                    <div key={i} className={`rounded-lg border px-3 py-2 ${styles}`}>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <span>{icon}</span>
                        {ins.title}
                      </p>
                      <p className="text-xs mt-0.5 text-foreground/80">{ins.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Save */}
          <div className="flex items-center justify-end gap-3">
            {pendingStudents > 0 && (
              <span className="text-xs text-muted-foreground">
                Faltan {pendingStudents} por marcar
              </span>
            )}
            {!online && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full bg-amber-500 animate-pulse" />
                Sin conexión
              </span>
            )}
            {pendingCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''} por sincronizar
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!canSaveAttendance}
              className="rounded-lg bg-primary text-primary-foreground px-6 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
            >
              {saveMutation.isPending
                ? 'Guardando…'
                : pendingStudents > 0
                  ? 'Completar asistencia'
                  : online
                    ? 'Guardar asistencia'
                    : 'Guardar (offline)'}
            </button>
          </div>
        </div>
      )}

      {/* QR Scanner overlay */}
      {showQr && (
        <QrScanner
          onScan={(id) => {
            if (!courseStudents.some((student) => student.id === id)) {
              toast.error('QR no corresponde a este curso');
              return;
            }
            setLocalStatus((p) => ({ ...p, [id]: 'PRESENT' }));
            toast.success('Alumno marcado presente');
          }}
          onClose={() => setShowQr(false)}
        />
      )}

      {/* Long-press status sheet */}
      {sheetFor &&
        (() => {
          const student = courseStudents.find((s) => s.id === sheetFor);
          if (!student) return null;
          return (
            <div
              className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
              onClick={() => setSheetFor(null)}
            >
              <div
                className="w-full sm:max-w-sm bg-background border-t sm:border border-border rounded-t-2xl sm:rounded-2xl p-4 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div>
                  <p className="text-xs text-muted-foreground">Cambiar estado</p>
                  <p className="font-semibold truncate">
                    {student.lastName}, {student.firstName}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {STATUS_CYCLE.map((s) => {
                    const cfg = STATUS_CONFIG[s];
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          setLocalStatus((p) => ({ ...p, [sheetFor]: s }));
                          setSheetFor(null);
                        }}
                        className={cn(
                          'min-h-[56px] rounded-lg font-semibold text-sm transition active:scale-95',
                          cfg.bg,
                          cfg.text,
                        )}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setSheetFor(null)}
                  className="w-full min-h-[44px] rounded-xl border border-border text-sm font-medium hover:bg-muted"
                >
                  Cancelar
                </button>
              </div>
            </div>
          );
        })()}
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
