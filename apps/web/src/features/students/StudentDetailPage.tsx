import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Copy, Star, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { parseDayLocal } from '@/lib/date';
import { formatStudentFullName } from '@/lib/student-name';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { ATTENDANCE_THRESHOLDS } from '@asistencia/shared';

type StudentStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  justified: number;
  attendanceRate: number;
};

type AttendanceRecord = {
  id: string;
  date: string;
  status: string;
  note?: string;
};

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  rut: string;
  enrollmentNumber: number;
  courseId: string;
};

type Guardian = {
  guardianId: string;
  studentId: string;
  relation: string;
  isPrimary: boolean;
  guardian: { id: string; email: string; firstName: string; lastName: string; status: string };
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PRESENT: { label: 'Presente', color: '#22c55e' },
  ABSENT: { label: 'Ausente', color: '#ef4444' },
  LATE: { label: 'Atraso', color: '#f97316' },
  JUSTIFIED: { label: 'Justificado', color: '#eab308' },
};

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

type Period = 'week' | 'month' | 'sem1' | 'sem2' | 'year' | 'all';

const PERIOD_LABELS: [Period, string][] = [
  ['week', 'Esta semana'],
  ['month', 'Este mes'],
  ['sem1', '1er semestre'],
  ['sem2', '2do semestre'],
  ['year', 'Este año'],
  ['all', 'Todo'],
];

function computeRange(period: Period): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === 'week') {
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return { from: fmt(mon), to: fmt(now) };
  }
  if (period === 'month') return { from: `${y}-${pad(now.getMonth() + 1)}-01`, to: fmt(now) };
  if (period === 'sem1') return { from: `${y}-03-01`, to: `${y}-06-30` };
  if (period === 'sem2') return { from: `${y}-08-01`, to: `${y}-12-15` };
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return {};
}

export function StudentDetailPage() {
  const { studentId } = useParams({ from: '/_auth/alumnos/$studentId' });
  const { courseId } = useSearch({ from: '/_auth/alumnos/$studentId' });
  const qc = useQueryClient();
  const currentUser = useUser();
  const effectiveSchoolId = useEffectiveSchoolId();
  const isAdmin =
    currentUser?.roles.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP', 'INSPECTORIA'].includes(r)) ??
    false;

  const [period, setPeriod] = useState<Period>('month');
  const [showAddGuardian, setShowAddGuardian] = useState(false);
  const [guardianForm, setGuardianForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    relation: 'APODERADO',
    isPrimary: false,
    createNew: true,
  });

  const range = computeRange(period);

  const { data: student } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => api.get<Student>(`/students/${studentId}`),
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['student-stats', studentId, range.from, range.to],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (range.from) qs.set('from', range.from);
      if (range.to) qs.set('to', range.to);
      return api.get<StudentStats>(`/students/${studentId}/stats${qs.size ? `?${qs}` : ''}`);
    },
  });

  const { data: records } = useQuery({
    queryKey: ['student-records', studentId, range.from, range.to],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (range.from) qs.set('from', range.from);
      if (range.to) qs.set('to', range.to);
      return api.get<AttendanceRecord[]>(
        `/attendance/student/${studentId}${qs.size ? `?${qs}` : ''}`,
      );
    },
  });

  const { data: guardians, isLoading: guardiansLoading } = useQuery({
    queryKey: ['student-guardians', studentId],
    queryFn: () => api.get<Guardian[]>(`/students/${studentId}/guardians`),
    enabled: isAdmin,
  });

  const addGuardianMut = useMutation({
    mutationFn: async () => {
      if (guardianForm.createNew) {
        const created = await api.post<{
          id: string;
          tempPassword: string | null;
          isExisting: boolean;
        }>('/users', {
          email: guardianForm.email,
          firstName: guardianForm.firstName,
          lastName: guardianForm.lastName,
          schoolId: effectiveSchoolId,
          sendWelcomeEmail: false,
        });
        await api.post(`/students/${studentId}/guardians`, {
          guardianId: created.id,
          relation: guardianForm.relation,
          isPrimary: guardianForm.isPrimary,
        });
        return created;
      } else {
        const users = await api.get<{ id: string; email: string }[]>(
          `/users?schoolId=${effectiveSchoolId}&roles=APODERADO`,
        );
        const found = users.find((u) => u.email.toLowerCase() === guardianForm.email.toLowerCase());
        if (!found) throw new Error('Apoderado no encontrado. Crea la cuenta primero.');
        await api.post(`/students/${studentId}/guardians`, {
          guardianId: found.id,
          relation: guardianForm.relation,
          isPrimary: guardianForm.isPrimary,
        });
        return null;
      }
    },
    onSuccess: (result) => {
      if (result && result.tempPassword) {
        toast.success(`Apoderado creado. Contraseña temporal: ${result.tempPassword}`, {
          duration: 15000,
          action: {
            label: 'Copiar',
            onClick: () => void navigator.clipboard.writeText(result.tempPassword!),
          },
        });
      } else {
        toast.success('Apoderado vinculado');
      }
      setShowAddGuardian(false);
      setGuardianForm({
        email: '',
        firstName: '',
        lastName: '',
        relation: 'APODERADO',
        isPrimary: false,
        createNew: true,
      });
      void qc.invalidateQueries({ queryKey: ['student-guardians', studentId] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const removeGuardianMut = useMutation({
    mutationFn: (guardianId: string) => api.del(`/students/${studentId}/guardians/${guardianId}`),
    onSuccess: () => {
      toast.success('Apoderado desvinculado');
      void qc.invalidateQueries({ queryKey: ['student-guardians', studentId] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const rateColor = (r: number) =>
    r >= ATTENDANCE_THRESHOLDS.GOOD
      ? '#22c55e'
      : r >= ATTENDANCE_THRESHOLDS.WARN
        ? '#f59e0b'
        : '#ef4444';

  const byMonth = records?.reduce<
    Record<string, { present: number; absent: number; month: string }>
  >((acc, r) => {
    const key = r.date.slice(0, 7);
    acc[key] ??= {
      present: 0,
      absent: 0,
      month:
        parseDayLocal(r.date)?.toLocaleString('es-CL', {
          month: 'short',
          year: '2-digit',
        }) ?? '—',
    };
    if (r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'JUSTIFIED')
      acc[key]!.present++;
    else if (r.status === 'ABSENT') acc[key]!.absent++;
    return acc;
  }, {});

  const chartData = Object.values(byMonth ?? {});

  const absencePatterns = records
    ? [0, 1, 2, 3, 4, 5, 6]
        .map((dow) => ({
          name: DAY_NAMES[dow]!,
          count: records.filter(
            (r) => parseDayLocal(r.date)?.getDay() === dow && r.status === 'ABSENT',
          ).length,
        }))
        .filter((d) => d.count >= 3)
    : [];

  return (
    <div className="space-y-6 max-w-3xl">
      {courseId && (
        <Link
          to="/cursos/$courseId"
          params={{ courseId }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Volver al curso
        </Link>
      )}

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="size-14 rounded-2xl bg-primary/10 flex items-center justify-center text-xl font-bold text-primary">
          {student?.firstName[0]}
          {student?.lastName[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{student ? formatStudentFullName(student) : '—'}</h1>
          <p className="text-sm text-muted-foreground">
            RUT {student?.rut} · N° {student?.enrollmentNumber}
          </p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PERIOD_LABELS.map(([p, label]) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
              period === p
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Stats cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse bg-muted rounded-xl" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Asistencia"
            value={`${(stats.attendanceRate * 100).toFixed(1)}%`}
            color={rateColor(stats.attendanceRate)}
          />
          <StatCard label="Presentes" value={String(stats.present)} color="#22c55e" />
          <StatCard label="Ausentes" value={String(stats.absent)} color="#ef4444" />
          <StatCard label="Justificados" value={String(stats.justified)} color="#eab308" />
        </div>
      ) : null}

      {/* Pattern alert */}
      {absencePatterns.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-900/10 p-4 space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-orange-800 dark:text-orange-300">
            <AlertTriangle className="size-4 shrink-0" />
            Patrón de ausencias detectado
          </p>
          {absencePatterns.map((d) => (
            <p key={d.name} className="text-sm text-orange-700 dark:text-orange-400">
              Ausente los <strong>{d.name}</strong> — {d.count} veces en el período seleccionado.
            </p>
          ))}
        </div>
      )}

      {/* Monthly chart */}
      {chartData.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5">
          <h2 className="text-sm font-semibold mb-4">Asistencia mensual</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="present" fill="#22c55e" name="Presente" radius={[3, 3, 0, 0]} />
              <Bar dataKey="absent" fill="#ef4444" name="Ausente" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Guardians */}
      {isAdmin && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Apoderados</h2>
            <button
              onClick={() => setShowAddGuardian(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground"
            >
              <UserPlus className="size-3.5" />
              Agregar
            </button>
          </div>

          {showAddGuardian && (
            <div className="p-5 border-b border-border bg-muted/20 space-y-3">
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setGuardianForm({ ...guardianForm, createNew: true })}
                  className={`px-3 py-1.5 rounded-lg border ${guardianForm.createNew ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
                >
                  Nueva cuenta
                </button>
                <button
                  onClick={() => setGuardianForm({ ...guardianForm, createNew: false })}
                  className={`px-3 py-1.5 rounded-lg border ${!guardianForm.createNew ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
                >
                  Cuenta existente
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="email"
                  placeholder="Email"
                  value={guardianForm.email}
                  onChange={(e) => setGuardianForm({ ...guardianForm, email: e.target.value })}
                  className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
                />
                {guardianForm.createNew && (
                  <>
                    <input
                      placeholder="Nombre"
                      value={guardianForm.firstName}
                      onChange={(e) =>
                        setGuardianForm({ ...guardianForm, firstName: e.target.value })
                      }
                      className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
                    />
                    <input
                      placeholder="Apellido"
                      value={guardianForm.lastName}
                      onChange={(e) =>
                        setGuardianForm({ ...guardianForm, lastName: e.target.value })
                      }
                      className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
                    />
                  </>
                )}
                <select
                  value={guardianForm.relation}
                  onChange={(e) => setGuardianForm({ ...guardianForm, relation: e.target.value })}
                  className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
                >
                  <option value="APODERADO">Apoderado</option>
                  <option value="MADRE">Madre</option>
                  <option value="PADRE">Padre</option>
                  <option value="TUTOR">Tutor legal</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={guardianForm.isPrimary}
                  onChange={(e) =>
                    setGuardianForm({ ...guardianForm, isPrimary: e.target.checked })
                  }
                  className="rounded"
                />
                Apoderado principal (recibirá notificaciones)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => addGuardianMut.mutate()}
                  disabled={
                    !guardianForm.email ||
                    (guardianForm.createNew &&
                      (!guardianForm.firstName || !guardianForm.lastName)) ||
                    addGuardianMut.isPending
                  }
                  className="text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {addGuardianMut.isPending ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  onClick={() => setShowAddGuardian(false)}
                  className="text-sm px-4 py-1.5 rounded-lg border border-border hover:bg-muted"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {guardiansLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse bg-muted rounded" />
              ))}
            </div>
          ) : !guardians?.length ? (
            <p className="p-5 text-sm text-muted-foreground text-center">
              Sin apoderados vinculados
            </p>
          ) : (
            <div className="data-scroll">
              <table className="w-full text-sm">
                <tbody>
                  {guardians.map((g) => (
                    <tr
                      key={g.guardianId}
                      className="border-t border-border hover:bg-muted/20 transition"
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium flex items-center gap-1.5">
                          {g.guardian.firstName} {g.guardian.lastName}
                          {g.isPrimary && (
                            <Star className="size-3.5 text-amber-500 fill-amber-500" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{g.guardian.email}</div>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{g.relation}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${g.guardian.status === 'ACTIVE' ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}
                        >
                          {g.guardian.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="Copiar email"
                            onClick={() => {
                              void navigator.clipboard.writeText(g.guardian.email);
                              toast.success('Email copiado');
                            }}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                          >
                            <Copy className="size-3.5" />
                          </button>
                          <button
                            title="Desvincular"
                            onClick={() => removeGuardianMut.mutate(g.guardianId)}
                            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* History table */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Historial</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-5 py-3">Fecha</th>
                <th className="text-left px-5 py-3">Día</th>
                <th className="text-left px-5 py-3">Estado</th>
                <th className="text-left px-5 py-3">Nota</th>
              </tr>
            </thead>
            <tbody>
              {records?.map((r) => {
                const d = parseDayLocal(r.date);
                const cfg = STATUS_LABELS[r.status];
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20 transition">
                    <td className="px-5 py-2.5 tabular-nums">
                      {d ? d.toLocaleDateString('es-CL') : r.date}
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground capitalize">
                      {d ? d.toLocaleDateString('es-CL', { weekday: 'long' }) : '—'}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: cfg?.color ?? '#888' }}
                      >
                        {cfg?.label ?? r.status}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground text-xs">{r.note ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
