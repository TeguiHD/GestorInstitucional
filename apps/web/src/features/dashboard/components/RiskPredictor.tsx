import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { api } from '@/lib/api';

type RiskStudent = {
  id: string;
  name: string;
  rut: string;
  course: string;
  avgRate: number;
  slope: number;
  risk: 'high' | 'medium' | 'stable';
  weekRates: number[];
};

const RISK_CONFIG = {
  high: {
    label: 'Riesgo alto',
    color: 'text-red-600   bg-red-50   dark:bg-red-900/20',
    Icon: TrendingDown,
  },
  medium: {
    label: 'En descenso',
    color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
    Icon: Minus,
  },
  stable: {
    label: 'Estable',
    color: 'text-green-600 bg-green-50 dark:bg-green-900/20',
    Icon: TrendingUp,
  },
};

function Sparkline({ rates }: { rates: number[] }) {
  const valid = rates.filter((r) => !isNaN(r));
  if (valid.length < 2) return null;
  const w = 60;
  const h = 24;
  const pts = valid
    .map((r, i) => {
      const x = (i / (valid.length - 1)) * w;
      const y = h - r * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="flex-shrink-0 overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
    </svg>
  );
}

export function RiskPredictor({ schoolId }: { schoolId: string }) {
  const { data = [], isLoading } = useQuery<RiskStudent[]>({
    queryKey: ['risk-prediction', schoolId],
    queryFn: () => api.get(`/insights/school/${schoolId}/risk-prediction`),
    enabled: !!schoolId,
    staleTime: 1000 * 60 * 10,
  });

  if (isLoading) return <div className="h-32 animate-pulse bg-muted rounded-xl" />;

  const atRisk = data.filter((s) => s.risk !== 'stable');
  if (!atRisk.length) return null;

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-900/10 overflow-hidden">
      <div className="px-5 py-4 border-b border-amber-200 dark:border-amber-800/40">
        <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Predicción riesgo repitencia — {atRisk.length} alumno{atRisk.length !== 1 ? 's' : ''}
        </h2>
        <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">
          Basado en tendencia últimas 4 semanas
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground uppercase tracking-wide bg-amber-50 dark:bg-amber-900/20">
              <th className="text-left px-5 py-2.5">Alumno</th>
              <th className="text-left px-5 py-2.5 hidden sm:table-cell">Curso</th>
              <th className="text-right px-5 py-2.5">Asistencia</th>
              <th className="text-center px-5 py-2.5 hidden md:table-cell">Tendencia</th>
              <th className="text-left px-5 py-2.5">Riesgo</th>
            </tr>
          </thead>
          <tbody>
            {atRisk.map((s) => {
              const cfg = RISK_CONFIG[s.risk];
              return (
                <tr
                  key={s.id}
                  className="border-t border-amber-100 dark:border-amber-800/20 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors"
                >
                  <td className="px-5 py-3">
                    <Link
                      to="/alumnos/$studentId"
                      params={{ studentId: s.id }}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {s.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{s.rut}</div>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                    {s.course}
                  </td>
                  <td
                    className="px-5 py-3 text-right font-semibold"
                    style={{
                      color: s.avgRate < 0.7 ? '#ef4444' : s.avgRate < 0.85 ? '#f59e0b' : '#22c55e',
                    }}
                  >
                    {(s.avgRate * 100).toFixed(1)}%
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell">
                    <div className="flex justify-center">
                      <Sparkline rates={s.weekRates} />
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.color}`}
                    >
                      <cfg.Icon className="h-3 w-3" /> {cfg.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
