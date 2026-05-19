import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ChevronDown, ChevronUp, LayoutDashboard, X } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '@/lib/api';
import { parseDayLocal } from '@/lib/date';
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

type DailyPoint = { date: string; total: number; present: number; rate: number };

type Period = 'this_month' | 'prev_month' | 'last_3m';

const PERIOD_LABELS: Record<Period, string> = {
  this_month: 'Este mes',
  prev_month: 'Mes anterior',
  last_3m: 'Últimos 3 meses',
};

function periodRange(p: Period): { from: string; to: string; label: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();

  if (p === 'this_month') {
    return {
      from: new Date(y, m, 1).toISOString().split('T')[0]!,
      to: today.toISOString().split('T')[0]!,
      label: today.toLocaleString('es-CL', { month: 'long', year: 'numeric' }),
    };
  }
  if (p === 'prev_month') {
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    const last = new Date(y, m, 0);
    return {
      from: new Date(py, pm, 1).toISOString().split('T')[0]!,
      to: last.toISOString().split('T')[0]!,
      label: last.toLocaleString('es-CL', { month: 'long', year: 'numeric' }),
    };
  }
  // last 3 months
  const start = new Date(y, m - 2, 1);
  return {
    from: start.toISOString().split('T')[0]!,
    to: today.toISOString().split('T')[0]!,
    label: 'Últimos 3 meses',
  };
}

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

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const pct = (delta * 100).toFixed(1);
  const up = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-green-600' : 'text-red-500'}`}
    >
      {up ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {pct}%
    </span>
  );
}

function CourseDrillDown({
  course,
  from,
  to,
  prevRate,
  onClose,
}: {
  course: CourseStats;
  from: string;
  to: string;
  prevRate: number | null;
  onClose: () => void;
}) {
  const { data: trend = [], isLoading } = useQuery<DailyPoint[]>({
    queryKey: ['course-daily-trend', course.id, from, to],
    queryFn: () => api.get(`/attendance/course/${course.id}/daily-trend?from=${from}&to=${to}`),
    staleTime: 1000 * 60 * 5,
  });

  const delta = prevRate !== null ? course.attendanceRate - prevRate : null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-sm">
            {course.name} <span className="text-muted-foreground font-normal">· {course.code}</span>
          </h3>
          <div className="flex items-center gap-3 mt-1">
            <RateBadge rate={course.attendanceRate} />
            <DeltaBadge delta={delta} />
            <span className="text-xs text-muted-foreground">{course.total} registros</span>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-48 animate-pulse bg-muted rounded-lg" />
      ) : trend.length < 2 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Sin datos suficientes</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d: string) =>
                parseDayLocal(d)?.toLocaleDateString('es-CL', {
                  day: '2-digit',
                  month: 'short',
                }) ?? d
              }
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              domain={[0, 1]}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Asistencia']}
              labelFormatter={(d: string) =>
                new Date(d + 'T12:00').toLocaleDateString('es-CL', { dateStyle: 'long' })
              }
            />
            <ReferenceLine y={ATTENDANCE_THRESHOLDS.WARN} stroke="#f59e0b" strokeDasharray="4 4" />
            <ReferenceLine y={ATTENDANCE_THRESHOLDS.GOOD} stroke="#22c55e" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="rate"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function DirectorDashboard() {
  const schoolId = useEffectiveSchoolId();
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const [period, setPeriod] = useState<Period>('this_month');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [atRiskExpanded, setAtRiskExpanded] = useState(false);

  const { from, to, label } = periodRange(period);
  const prevRange = periodRange('prev_month');

  const { data: stats, isLoading } = useQuery<CourseStats[]>({
    queryKey: ['school-stats', schoolId, from, to],
    queryFn: () => api.get(`/attendance/school/${schoolId}/stats?from=${from}&to=${to}`),
    enabled: !!schoolId,
  });

  const { data: prevStats } = useQuery<CourseStats[]>({
    queryKey: ['school-stats', schoolId, prevRange.from, prevRange.to],
    queryFn: () =>
      api.get(`/attendance/school/${schoolId}/stats?from=${prevRange.from}&to=${prevRange.to}`),
    enabled: !!schoolId,
    staleTime: 1000 * 60 * 10,
  });

  const prevRateById = new Map<string, number>(
    prevStats?.map((c) => [c.id, c.attendanceRate]) ?? [],
  );

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
  const prevAvgRate = prevStats?.length
    ? prevStats.reduce((s, c) => s + c.attendanceRate, 0) / prevStats.length
    : null;

  const worst = stats?.at(-1);
  const criticalCourses = stats?.filter((c) => c.attendanceRate < ATTENDANCE_THRESHOLDS.WARN) ?? [];
  const selectedCourse = stats?.find((c) => c.id === selectedCourseId) ?? null;

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

  const atRiskList = atRisk?.students ?? [];
  const visibleAtRisk = atRiskExpanded ? atRiskList : atRiskList.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        {/* Period picker */}
        <div className="flex gap-1 rounded-lg border border-border p-1 bg-background">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPeriod(p);
                setSelectedCourseId(null);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Asistencia general"
          value={`${(avgRate * 100).toFixed(1)}%`}
          sub={`${stats?.length ?? 0} cursos activos`}
          color={rateColor(avgRate)}
          delta={prevAvgRate !== null ? avgRate - prevAvgRate : null}
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
                {visibleAtRisk.map((s) => (
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
            <button
              onClick={() => setAtRiskExpanded((v) => !v)}
              className="w-full px-5 py-2.5 text-xs text-muted-foreground border-t border-destructive/10 hover:bg-destructive/5 transition text-left"
            >
              {atRiskExpanded ? 'Ver menos ↑' : `Ver ${atRisk.count - 10} más… ↓`}
            </button>
          )}
        </div>
      )}

      {/* Bar chart — clickable */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Asistencia por curso</h2>
          {selectedCourseId && (
            <button
              onClick={() => setSelectedCourseId(null)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Deseleccionar
            </button>
          )}
        </div>
        {isLoading ? (
          <div className="h-64 animate-pulse bg-muted rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={stats ?? []}
              margin={{ top: 0, right: 8, left: -16, bottom: 0 }}
              onClick={(d) => {
                const id = (d?.activePayload?.[0]?.payload as CourseStats | undefined)?.id;
                setSelectedCourseId(id === selectedCourseId ? null : (id ?? null));
              }}
              style={{ cursor: 'pointer' }}
            >
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
                formatter={(v: number, _n: string, props: { payload?: CourseStats }) => {
                  const prev = props.payload ? prevRateById.get(props.payload.id) : null;
                  const delta = prev !== undefined && prev !== null ? v - prev : null;
                  return [
                    `${(v * 100).toFixed(1)}%${delta !== null ? ` (${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}% vs mes ant.)` : ''}`,
                    'Asistencia',
                  ];
                }}
                labelFormatter={(l) => `Curso ${l}`}
              />
              <Bar dataKey="attendanceRate" radius={[4, 4, 0, 0]} fill="var(--color-primary)">
                {stats?.map((entry) => (
                  <Cell
                    key={entry.id}
                    fill={rateColor(entry.attendanceRate)}
                    opacity={selectedCourseId && selectedCourseId !== entry.id ? 0.35 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {selectedCourse && (
          <div className="mt-4">
            <CourseDrillDown
              course={selectedCourse}
              from={from}
              to={to}
              prevRate={prevRateById.get(selectedCourse.id) ?? null}
              onClose={() => setSelectedCourseId(null)}
            />
          </div>
        )}
      </div>

      {/* Heatmap */}
      <AttendanceHeatmap schoolId={schoolId} year={year} month={month} />

      {/* Risk prediction */}
      <RiskPredictor schoolId={schoolId} />

      {/* Ranking table — clickable */}
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
                <th className="text-right px-5 py-3 hidden sm:table-cell">vs mes ant.</th>
                <th className="text-right px-5 py-3">Registros</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td colSpan={5} className="px-5 py-3">
                        <div className="h-4 animate-pulse bg-muted rounded w-full" />
                      </td>
                    </tr>
                  ))
                : stats?.map((course, i) => {
                    const prev = prevRateById.get(course.id);
                    const delta = prev !== undefined ? course.attendanceRate - prev : null;
                    const isSelected = selectedCourseId === course.id;
                    return (
                      <tr
                        key={course.id}
                        onClick={() => setSelectedCourseId(isSelected ? null : course.id)}
                        className={`border-t border-border cursor-pointer transition ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                      >
                        <td className="px-5 py-3 text-muted-foreground font-mono">{i + 1}</td>
                        <td className="px-5 py-3 font-medium">{course.name}</td>
                        <td className="px-5 py-3 text-right">
                          <RateBadge rate={course.attendanceRate} />
                        </td>
                        <td className="px-5 py-3 text-right hidden sm:table-cell">
                          <DeltaBadge delta={delta} />
                        </td>
                        <td className="px-5 py-3 text-right text-muted-foreground">
                          {course.total}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        {selectedCourse && (
          <div className="px-5 py-5 border-t border-border">
            <CourseDrillDown
              course={selectedCourse}
              from={from}
              to={to}
              prevRate={prevRateById.get(selectedCourse.id) ?? null}
              onClose={() => setSelectedCourseId(null)}
            />
          </div>
        )}
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
  delta,
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  delta?: number | null;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-5 space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      {loading ? (
        <div className="h-8 w-24 animate-pulse bg-muted rounded" />
      ) : (
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold" style={{ color }}>
            {value}
          </p>
          {delta !== null && delta !== undefined && <DeltaBadge delta={delta} />}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
