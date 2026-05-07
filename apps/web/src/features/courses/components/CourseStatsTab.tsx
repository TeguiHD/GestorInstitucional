import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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
import { AlertTriangle, Info, Users, XCircle } from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type StudentStat = {
  id: string;
  firstName: string;
  lastName: string;
  enrollmentNumber: number;
  total: number;
  present: number;
  absent: number;
  justified: number;
  rate: number | null;
};

type MatrixData = {
  students: StudentStat[];
  dates: string[];
  matrix: Record<string, Record<string, string>>;
};

type MonthSummaryEntry = {
  date: string;
  present: number;
  absent: number;
  late: number;
  justified: number;
  total: number;
  attendanceRate: number;
};

type Insight = {
  type: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
};
type CourseInsights = { period: string; attendanceRate: number; insights: Insight[] };

const STATUS_COLOR: Record<string, string> = {
  PRESENT: '#22c55e',
  ABSENT: '#ef4444',
  LATE: '#f97316',
  JUSTIFIED: '#eab308',
};

const STATUS_BG: Record<string, string> = {
  PRESENT: 'bg-green-500',
  ABSENT: 'bg-red-500',
  LATE: 'bg-orange-500',
  JUSTIFIED: 'bg-yellow-400',
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

function rateColor(r: number | null): string {
  if (r == null) return '#94a3b8';
  if (r >= 0.9) return '#22c55e';
  if (r >= 0.7) return '#f59e0b';
  return '#ef4444';
}

function rateBg(r: number | null): string {
  if (r == null) return 'bg-muted text-muted-foreground';
  if (r >= 0.9) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  if (r >= 0.7) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

export function CourseStatsTab({ courseId }: { courseId: string }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const { data: matrix, isLoading: matrixLoading } = useQuery<MatrixData>({
    queryKey: ['course-matrix', courseId, year, month],
    queryFn: () => api.get(`/attendance/course/${courseId}/matrix?year=${year}&month=${month}`),
  });

  const { data: monthSummary } = useQuery<MonthSummaryEntry[]>({
    queryKey: ['course-month-summary', courseId, year, month],
    queryFn: () => api.get(`/attendance/course/${courseId}/month?year=${year}&month=${month}`),
  });

  const { data: insights } = useQuery<CourseInsights>({
    queryKey: ['course-insights', courseId, year, month],
    queryFn: () => api.get(`/insights/course/${courseId}?year=${year}&month=${month}`),
  });

  const students = matrix?.students ?? [];
  const validRates = students.filter((s) => s.rate != null);
  const avgRate =
    validRates.length > 0
      ? validRates.reduce((acc, s) => acc + s.rate!, 0) / validRates.length
      : null;

  const atRisk = students.filter((s) => s.rate != null && s.rate < 0.75).length;
  const sorted = [...students].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1));
  const best = [...students].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))[0] ?? null;
  const worst = sorted[0] ?? null;

  const trendData = (monthSummary ?? []).map((d) => ({
    label: `${new Date(d.date.split('T')[0]! + 'T12:00').getDate()}`,
    rate: d.attendanceRate,
  }));

  return (
    <div className="space-y-5">
      {/* Month selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
        >
          {[today.getFullYear() - 1, today.getFullYear()].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Asistencia general"
          value={avgRate != null ? `${(avgRate * 100).toFixed(1)}%` : '—'}
          color={rateColor(avgRate)}
          sub={`${students.length} alumnos`}
          loading={matrixLoading}
        />
        <KpiCard
          label="Bajo 75%"
          value={String(atRisk)}
          color={atRisk > 0 ? '#ef4444' : '#22c55e'}
          sub="alumnos en riesgo"
          loading={matrixLoading}
        />
        <KpiCard
          label="Mejor asistencia"
          value={best?.rate != null ? `${(best.rate * 100).toFixed(0)}%` : '—'}
          color="#22c55e"
          sub={best ? `${best.lastName}, ${best.firstName}` : '—'}
          loading={matrixLoading}
        />
        <KpiCard
          label="Requiere atención"
          value={
            worst?.rate != null && worst.rate < 0.9 ? `${(worst.rate * 100).toFixed(0)}%` : '—'
          }
          color={rateColor(worst?.rate ?? null)}
          sub={
            worst?.rate != null && worst.rate < 0.9
              ? `${worst.lastName}, ${worst.firstName}`
              : 'Todos al día'
          }
          loading={matrixLoading}
        />
      </div>

      {/* Trend chart */}
      {trendData.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5">
          <h3 className="text-sm font-semibold mb-4">
            Tendencia diaria — {MONTH_NAMES[month - 1]} {year}
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Asistencia']}
                labelFormatter={(l) => `Día ${l}`}
              />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {trendData.map((d, i) => (
                  <Cell key={i} fill={rateColor(d.rate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Heatmap */}
      {matrix && matrix.dates.length > 0 && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Mapa de asistencia — alumno × día</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ordenado por asistencia (menor primero).
            </p>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-max">
              {/* Header */}
              <div className="flex items-center gap-px px-4 py-2 border-b border-border bg-muted/30">
                <div className="w-44 text-xs text-muted-foreground font-medium shrink-0">
                  Alumno
                </div>
                {matrix.dates.map((d) => {
                  const dt = new Date(d + 'T12:00');
                  const dow = ['L', 'M', 'X', 'J', 'V', 'S', 'D'][(dt.getDay() + 6) % 7];
                  return (
                    <div key={d} className="w-7 flex flex-col items-center">
                      <span className="text-[9px] text-muted-foreground">{dow}</span>
                      <span className="text-[10px] font-medium">{dt.getDate()}</span>
                    </div>
                  );
                })}
                <div className="w-14 text-xs text-muted-foreground font-medium text-right shrink-0 pl-2">
                  %
                </div>
              </div>
              {/* Rows */}
              {sorted.map((s, i) => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-px px-4 py-1.5',
                    i % 2 === 0 ? 'bg-background' : 'bg-muted/20',
                  )}
                >
                  <div className="w-44 text-xs truncate shrink-0 font-medium">
                    {s.lastName}, {s.firstName}
                  </div>
                  {matrix.dates.map((d) => {
                    const status = matrix.matrix[s.id]?.[d];
                    return (
                      <div
                        key={d}
                        title={`${s.firstName} · ${d} · ${status ?? 'Sin registro'}`}
                        className={cn(
                          'w-7 h-5 rounded-sm flex-shrink-0',
                          status ? (STATUS_BG[status] ?? 'bg-muted') : 'bg-muted/40',
                        )}
                      />
                    );
                  })}
                  <div className="w-14 text-right shrink-0 pl-2">
                    <span
                      className={cn(
                        'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        rateBg(s.rate),
                      )}
                    >
                      {s.rate != null ? `${(s.rate * 100).toFixed(0)}%` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 px-5 py-2.5 border-t border-border bg-muted/20 flex-wrap">
            {Object.entries(STATUS_COLOR).map(([s, c]) => (
              <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block size-3 rounded-sm" style={{ backgroundColor: c }} />
                {s === 'PRESENT'
                  ? 'Presente'
                  : s === 'ABSENT'
                    ? 'Ausente'
                    : s === 'LATE'
                      ? 'Atraso'
                      : 'Justificado'}
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block size-3 rounded-sm bg-muted/40" />
              Sin registro
            </div>
          </div>
        </div>
      )}

      {/* Ranking table */}
      {students.length > 0 && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Ranking de asistencia</h3>
          </div>
          <div className="data-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                  <th className="text-left px-5 py-2.5">#</th>
                  <th className="text-left px-5 py-2.5">Alumno</th>
                  <th className="text-center px-3 py-2.5">Presentes</th>
                  <th className="text-center px-3 py-2.5">Ausentes</th>
                  <th className="text-center px-3 py-2.5">Justif.</th>
                  <th className="text-right px-5 py-2.5">%</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => (
                  <tr key={s.id} className="border-t border-border hover:bg-muted/20 transition">
                    <td className="px-5 py-2.5 text-muted-foreground text-xs">{i + 1}</td>
                    <td className="px-5 py-2.5 font-medium">
                      {s.lastName}, {s.firstName}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-green-600 dark:text-green-400">
                      {s.present}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-red-600 dark:text-red-400">
                      {s.absent}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-yellow-600 dark:text-yellow-400">
                      {s.justified}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-semibold',
                          rateBg(s.rate),
                        )}
                      >
                        {s.rate != null ? `${(s.rate * 100).toFixed(1)}%` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights && insights.insights.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            Análisis inteligente — {insights.period}
          </h3>
          <div className="space-y-2">
            {insights.insights.map((ins, i) => {
              const cfg = {
                info: {
                  bg: 'bg-blue-50 dark:bg-blue-900/20',
                  border: 'border-blue-200 dark:border-blue-800',
                  text: 'text-blue-800 dark:text-blue-300',
                  icon: Info,
                },
                warn: {
                  bg: 'bg-amber-50 dark:bg-amber-900/20',
                  border: 'border-amber-200 dark:border-amber-800',
                  text: 'text-amber-800 dark:text-amber-300',
                  icon: AlertTriangle,
                },
                critical: {
                  bg: 'bg-red-50 dark:bg-red-900/20',
                  border: 'border-red-200 dark:border-red-800',
                  text: 'text-red-800 dark:text-red-300',
                  icon: XCircle,
                },
              }[ins.severity];
              const Icon = cfg.icon;
              return (
                <div key={i} className={cn('rounded-lg border p-3', cfg.bg, cfg.border)}>
                  <div className={cn('text-xs font-semibold flex items-center gap-1.5', cfg.text)}>
                    <Icon className="size-3.5 shrink-0" /> {ins.title}
                  </div>
                  <p className={cn('text-xs mt-1 opacity-80', cfg.text)}>{ins.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!matrixLoading && matrix && matrix.dates.length === 0 && (
        <div className="rounded-xl border border-border bg-background p-10 text-center">
          <Users className="size-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            Sin registros para {MONTH_NAMES[month - 1]} {year}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Cambia el mes o comienza a registrar asistencia.
          </p>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
  sub,
  loading,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      {loading ? (
        <div className="h-8 w-20 animate-pulse bg-muted rounded" />
      ) : (
        <p className="text-2xl font-bold" style={{ color }}>
          {value}
        </p>
      )}
      {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
    </div>
  );
}
