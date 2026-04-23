import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

type HeatRow = { course: string; days: { dow: number; rate: number | null }[] };

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];

function rateToColor(rate: number | null): string {
  if (rate === null) return 'bg-muted text-muted-foreground';
  if (rate >= 0.9) return 'bg-green-500 text-white';
  if (rate >= 0.8) return 'bg-yellow-400 text-white';
  if (rate >= 0.7) return 'bg-orange-400 text-white';
  return 'bg-red-500 text-white';
}

export function AttendanceHeatmap({
  schoolId,
  year,
  month,
}: {
  schoolId: string;
  year: number;
  month: number;
}) {
  const { data = [], isLoading } = useQuery<HeatRow[]>({
    queryKey: ['heatmap', schoolId, year, month],
    queryFn: () => api.get(`/insights/school/${schoolId}/heatmap?year=${year}&month=${month}`),
    enabled: !!schoolId,
  });

  if (isLoading) return <div className="h-48 animate-pulse bg-muted rounded-xl" />;
  if (!data.length) return null;

  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <h2 className="text-sm font-semibold mb-4">Asistencia por día × curso</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[320px]">
          <thead>
            <tr>
              <th className="text-left pr-4 py-1.5 text-muted-foreground font-medium w-20">
                Curso
              </th>
              {DAYS.map((d) => (
                <th key={d} className="text-center text-muted-foreground font-medium px-1 w-14">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.course}>
                <td className="pr-4 py-1 font-semibold text-foreground">{row.course}</td>
                {row.days.map((cell) => (
                  <td key={cell.dow} className="py-1 px-1">
                    <div
                      title={cell.rate !== null ? `${(cell.rate * 100).toFixed(1)}%` : 'Sin datos'}
                      className={`h-8 rounded-lg flex items-center justify-center text-xs font-semibold ${rateToColor(cell.rate)}`}
                    >
                      {cell.rate !== null ? `${(cell.rate * 100).toFixed(0)}%` : '—'}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-green-500 inline-block" /> ≥90%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-yellow-400 inline-block" /> 80–89%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-orange-400 inline-block" /> 70–79%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-red-500 inline-block" /> &lt;70%
          </span>
        </div>
      </div>
    </div>
  );
}
