import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useEffectiveSchoolId } from '@/stores/school.store';

export const Route = createFileRoute('/_auth/reportes')({
  component: ReportsPage,
});

type Course = { id: string; name: string; code: string };

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

async function downloadReport(path: string, filename: string) {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });
  if (!res.ok) throw new Error('Error al generar reporte');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const schoolId = useEffectiveSchoolId();
  const today = new Date();

  const [courseId, setCourseId] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [semester, setSemester] = useState(today.getMonth() < 6 ? 1 : 2);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // Monday
    return d.toISOString().split('T')[0]!;
  });
  const [loading, setLoading] = useState<string | null>(null);

  const { data: courses } = useQuery<Course[]>({
    queryKey: ['courses', schoolId],
    queryFn: () => api.get(`/courses?schoolId=${schoolId}`),
    enabled: !!schoolId,
  });

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

  const download = async (type: string, path: string, filename: string) => {
    if (!courseId) {
      toast.error('Selecciona un curso');
      return;
    }
    setLoading(type);
    try {
      await downloadReport(path, filename);
      toast.success('Reporte descargado');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const courseLabel = courses?.find((c) => c.id === courseId)?.code ?? 'CURSO';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Exporta asistencia en Excel o PDF — semanal, mensual o semestral
        </p>
      </div>

      {/* Course selector */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <h2 className="text-sm font-semibold">Curso</h2>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
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

      {/* Weekly */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <h2 className="text-sm font-semibold">Reporte Semanal</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Semana desde (lunes)</label>
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
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 mt-4"
          >
            <Download className="size-4" />
            {loading === 'weekly' ? 'Generando…' : 'Excel semanal'}
          </button>
        </div>
      </div>

      {/* Monthly */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <h2 className="text-sm font-semibold">Reporte Mensual</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Año</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min={2020}
              max={2030}
              className="w-24 rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Mes</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() =>
                download(
                  'month-xlsx',
                  `/reports/course/${courseId}/excel?year=${year}&month=${month}`,
                  `asistencia-${year}-${String(month).padStart(2, '0')}-${courseLabel}.xlsx`,
                )
              }
              disabled={loading === 'month-xlsx'}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Download className="size-4" />
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
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <Download className="size-4" />
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
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
              title="Lista oficial estilo MINEDUC con grilla día×alumno (A4 horizontal)"
            >
              <Download className="size-4" />
              {loading === 'month-grid-pdf' ? 'Generando…' : 'PDF MINEDUC'}
            </button>
          </div>
        </div>
      </div>

      {/* Semester */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <h2 className="text-sm font-semibold">Reporte Semestral</h2>
        <p className="text-xs text-muted-foreground">
          S1 = Ene–Jun · S2 = Jul–Dic. Excel incluye una hoja por mes + resumen consolidado.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Año</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min={2020}
              max={2030}
              className="w-24 rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Semestre</label>
            <select
              value={semester}
              onChange={(e) => setSemester(Number(e.target.value))}
              className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
            >
              <option value={1}>1er Semestre (Ene–Jun)</option>
              <option value={2}>2do Semestre (Jul–Dic)</option>
            </select>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() =>
                download(
                  'sem-xlsx',
                  `/reports/course/${courseId}/semester?year=${year}&semester=${semester}`,
                  `semestre${semester}-${year}-${courseLabel}.xlsx`,
                )
              }
              disabled={loading === 'sem-xlsx'}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Download className="size-4" />
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
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <Download className="size-4" />
              {loading === 'sem-pdf' ? 'Generando…' : 'PDF semestral'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
