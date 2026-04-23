import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, LayoutDashboard } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '@/lib/api';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { EmptyState } from '@/components/ui/EmptyState';
import { ATTENDANCE_THRESHOLDS } from '@asistencia/shared';
import { AttendanceHeatmap } from './components/AttendanceHeatmap';
import { RiskPredictor } from './components/RiskPredictor';

type CourseStats = {
  id: string;
  code: string;
  name: string;
  attendanceRate: number;
  total: number;
  present: number;
};

type Insight = {
  type: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
};

type SchoolInsights = {
  period: string;
  overallRate: number;
  insights: Insight[];
};

function rateColor(rate: number): string {
  if (rate >= ATTENDANCE_THRESHOLDS.GOOD) return '#22c55e';
  if (rate >= ATTENDANCE_THRESHOLDS.WARN) return '#f59e0b';
  return '#ef4444';
}

function RateBadge({ rate }: { rate: number }) {
  const pct = `${(rate * 100).toFixed(1)}%`;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: rateColor(rate) }}
    >
      {pct}
    </span>
  );
}

export function DirectorDashboard() {
  const schoolId = useEffectiveSchoolId();
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const to = today.toISOString().split('T')[0];

  const { data: stats, isLoading } = useQuery<CourseStats[]>({
    queryKey: ['school-stats', schoolId, from, to],
    queryFn: () => api.get(`/attendance/school/${schoolId}/stats?from=${from}&to=${to}`),
    enabled: !!schoolId,
  });

  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const { data: insights } = useQuery<SchoolInsights>({
    queryKey: ['school-insights', schoolId, year, month],
    queryFn: () => api.get(`/insights/school/${schoolId}?year=${year}&month=${month}`),
    enabled: !!schoolId,
  });

  type AtRiskStudent = {
    id: string;
    firstName: string;
    lastName: string;
    rut: string;
    attendanceRate: number;
    course: { id: string; name: string; code: string };
  };
  const { data: atRisk } = useQuery<{ count: number; students: AtRiskStudent[] }>({
    queryKey: ['at-risk', schoolId, year, month],
    queryFn: () => api.get(`/insights/school/${schoolId}/at-risk?year=${year}&month=${month}`),
    enabled: !!schoolId,
  });

  const avgRate = stats?.length
    ? stats.reduce((s, c) => s + c.attendanceRate, 0) / stats.length
    : 0;

  const worst = stats?.at(-1);
  const criticalCourses = stats?.filter((c) => c.attendanceRate < ATTENDANCE_THRESHOLDS.WARN) ?? [];

  if (!schoolId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <EmptyState
          icon={LayoutDashboard}
          title="Sin colegio asignado"
          description="Tu cuenta no está vinculada a ningún colegio. Crea un colegio o pide a un administrador que te asigne uno."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Mes {today.toLocaleString('es-CL', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Asistencia general"
          value={`${(avgRate * 100).toFixed(1)}%`}
          sub={`${stats?.length ?? 0} cursos activos`}
          color={rateColor(avgRate)}
          loading={isLoading}
        />
        <KpiCard
          label="Cursos críticos"
          value={String(criticalCourses.length)}
          sub="< 70% asistencia"
          color="#ef4444"
          loading={isLoading}
        />
        <KpiCard
          label="Mejor curso"
          value={stats?.[0]?.code ?? '—'}
          sub={stats?.[0] ? `${(stats[0].attendanceRate * 100).toFixed(1)}%` : ''}
          color="#22c55e"
          loading={isLoading}
        />
        <KpiCard
          label="Menor asistencia"
          value={worst?.code ?? '—'}
          sub={worst ? `${(worst.attendanceRate * 100).toFixed(1)}%` : ''}
          color="#f59e0b"
          loading={isLoading}
        />
      </div>

      {/* Insights IA */}
      {insights && insights.insights.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Insights automáticos</h2>
            <span className="text-xs text-muted-foreground">{insights.period}</span>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {insights.insights.map((ins, i) => (
              <InsightCard key={i} insight={ins} />
            ))}
          </div>
        </div>
      )}

      {/* At-risk students */}
      {atRisk && atRisk.count > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-destructive/20 flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <h2 className="text-sm font-semibold text-destructive">
              {atRisk.count} alumno{atRisk.count !== 1 ? 's' : ''} bajo 70% de asistencia este mes
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-destructive/5 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-5 py-2.5">Alumno</th>
                  <th className="text-left px-5 py-2.5">Curso</th>
                  <th className="text-right px-5 py-2.5">Asistencia</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.students.slice(0, 10).map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-destructive/10 hover:bg-destructive/5 transition"
                  >
                    <td className="px-5 py-2.5">
                      <Link
                        to="/alumnos/$studentId"
                        params={{ studentId: s.id }}
                        className="font-medium hover:text-primary transition"
                      >
                        {s.lastName}, {s.firstName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{s.rut}</div>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">
                      {s.course.code} — {s.course.name}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-white bg-destructive">
                        {(s.attendanceRate * 100).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {atRisk.count > 10 && (
            <div className="px-5 py-2 text-xs text-muted-foreground border-t border-destructive/10">
              Y {atRisk.count - 10} más…
            </div>
          )}
        </div>
      )}

      {/* Bar chart */}
      <div className="rounded-xl border border-border bg-background p-5">
        <h2 className="text-sm font-semibold mb-4">Asistencia por curso</h2>
        {isLoading ? (
          <div className="h-64 animate-pulse bg-muted rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats ?? []} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="code" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                domain={[0, 1]}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  color: 'var(--color-foreground)',
                  fontSize: '13px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
                cursor={{ fill: 'rgba(0, 130, 105, 0.08)' }}
                formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Asistencia']}
                labelFormatter={(l) => `Curso ${l}`}
              />
              {/* fill required so Recharts doesn't grey out bars on hover when using <Cell> */}
              <Bar dataKey="attendanceRate" radius={[4, 4, 0, 0]} fill="var(--color-primary)">
                {stats?.map((entry) => (
                  <Cell key={entry.id} fill={rateColor(entry.attendanceRate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Heatmap */}
      <AttendanceHeatmap schoolId={schoolId} year={year} month={month} />

      {/* Risk prediction */}
      <RiskPredictor schoolId={schoolId} />

      {/* Ranking table */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Ranking de cursos</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-5 py-3">Pos.</th>
                <th className="text-left px-5 py-3">Curso</th>
                <th className="text-right px-5 py-3">Asistencia</th>
                <th className="text-right px-5 py-3">Registros</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td colSpan={4} className="px-5 py-3">
                        <div className="h-4 animate-pulse bg-muted rounded w-full" />
                      </td>
                    </tr>
                  ))
                : stats?.map((course, i) => (
                    <tr
                      key={course.id}
                      className="border-t border-border hover:bg-muted/30 transition"
                    >
                      <td className="px-5 py-3 text-muted-foreground font-mono">{i + 1}</td>
                      <td className="px-5 py-3 font-medium">{course.name}</td>
                      <td className="px-5 py-3 text-right">
                        <RateBadge rate={course.attendanceRate} />
                      </td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{course.total}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const styles = {
    info: 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400',
    warn: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
    critical: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400',
  }[insight.severity];
  const icon = { info: 'ℹ', warn: '⚠', critical: '⛔' }[insight.severity];
  return (
    <div className={`rounded-lg border px-4 py-3 ${styles}`}>
      <p className="text-sm font-semibold flex items-center gap-2">
        <span>{icon}</span>
        {insight.title}
      </p>
      <p className="text-xs mt-1 text-foreground/80">{insight.detail}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  color,
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-5 space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      {loading ? (
        <div className="h-8 w-24 animate-pulse bg-muted rounded" />
      ) : (
        <p className="text-2xl font-bold" style={{ color }}>
          {value}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
