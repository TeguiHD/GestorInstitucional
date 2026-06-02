import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Save, Settings, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { SchoolSelector } from '@/components/ui/SchoolSelector';
import { ApiError, api } from '@/lib/api';
import { useAuthStore, useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';

export const Route = createFileRoute('/_auth/configuracion')({
  beforeLoad: () => {
    const user = useAuthStore.getState().user;
    if (user && !user.roles.includes('SUPER_ADMIN')) throw redirect({ to: '/', replace: true });
  },
  component: ConfiguracionPage,
});

type AcademicYearConfig = {
  schoolId: string;
  year: number;
  source: 'saved' | 'default';
  firstSemester: { startDate: string; endDate: string };
  secondSemester: { startDate: string; endDate: string };
  annual: { ranges: Array<{ startDate: string; endDate: string }> };
};

type FormState = {
  firstSemesterStart: string;
  firstSemesterEnd: string;
  secondSemesterStart: string;
  secondSemesterEnd: string;
};

const currentYear = new Date().getFullYear();

function ConfiguracionPage() {
  const user = useUser();
  const schoolId = useEffectiveSchoolId();
  const qc = useQueryClient();
  const [year, setYear] = useState(currentYear);
  const [form, setForm] = useState<FormState>({
    firstSemesterStart: '',
    firstSemesterEnd: '',
    secondSemesterStart: '',
    secondSemesterEnd: '',
  });

  const { data: config, isLoading } = useQuery<AcademicYearConfig>({
    queryKey: ['school-academic-year-config', schoolId, year],
    queryFn: () => api.get(`/school-config/${schoolId}/academic-year/${year}`),
    enabled: !!schoolId,
  });

  useEffect(() => {
    if (!config) return;
    setForm({
      firstSemesterStart: config.firstSemester.startDate,
      firstSemesterEnd: config.firstSemester.endDate,
      secondSemesterStart: config.secondSemester.startDate,
      secondSemesterEnd: config.secondSemester.endDate,
    });
  }, [config]);

  const save = useMutation({
    mutationFn: (body: FormState) =>
      api.put<AcademicYearConfig>(`/school-config/${schoolId}/academic-year/${year}`, body),
    onSuccess: (saved) => {
      toast.success('Configuración escolar guardada');
      void qc.setQueryData(['school-academic-year-config', schoolId, year], saved);
      void qc.invalidateQueries({ queryKey: ['school-academic-year-config', schoolId, year] });
      void qc.invalidateQueries({ queryKey: ['course-summary-report'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const conflict = useMemo(() => conflictFromError(save.error), [save.error]);
  const hasChanges =
    !!config &&
    (form.firstSemesterStart !== config.firstSemester.startDate ||
      form.firstSemesterEnd !== config.firstSemester.endDate ||
      form.secondSemesterStart !== config.secondSemester.startDate ||
      form.secondSemesterEnd !== config.secondSemester.endDate);

  if (!user?.roles.includes('SUPER_ADMIN')) return null;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuración escolar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fechas oficiales de inicio y término para reportes semestrales y anuales.
          </p>
        </div>
        <SchoolSelector />
      </div>

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="border-b border-border px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
              <Settings className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Año escolar</h2>
              <p className="text-xs text-muted-foreground">
                {config?.source === 'saved' ? 'Configuración guardada' : 'Valores por defecto'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="year">
              Año
            </label>
            <input
              id="year"
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        {!schoolId ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Selecciona un colegio para gestionar sus fechas.
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <form
            className="p-5 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(form);
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <SemesterFieldset
                title="Primer semestre"
                startId="firstSemesterStart"
                endId="firstSemesterEnd"
                startValue={form.firstSemesterStart}
                endValue={form.firstSemesterEnd}
                onStartChange={(value) =>
                  setForm((current) => ({ ...current, firstSemesterStart: value }))
                }
                onEndChange={(value) =>
                  setForm((current) => ({ ...current, firstSemesterEnd: value }))
                }
              />
              <SemesterFieldset
                title="Segundo semestre"
                startId="secondSemesterStart"
                endId="secondSemesterEnd"
                startValue={form.secondSemesterStart}
                endValue={form.secondSemesterEnd}
                onStartChange={(value) =>
                  setForm((current) => ({ ...current, secondSemesterStart: value }))
                }
                onEndChange={(value) =>
                  setForm((current) => ({ ...current, secondSemesterEnd: value }))
                }
              />
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CalendarDays className="size-4 text-muted-foreground" />
                Año escolar configurado
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatRange(form.firstSemesterStart, form.firstSemesterEnd)} ·{' '}
                {formatRange(form.secondSemesterStart, form.secondSemesterEnd)}
              </p>
            </div>

            {conflict && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                <div className="flex items-center gap-2 font-semibold">
                  <TriangleAlert className="size-4" />
                  Asistencias fuera del período
                </div>
                <p className="mt-1 text-xs">{conflict.message}</p>
                <p className="mt-2 text-xs font-medium">
                  Fechas detectadas: {conflict.conflictingDates.join(', ')}
                  {conflict.totalConflicts > conflict.conflictingDates.length
                    ? ` y ${conflict.totalConflicts - conflict.conflictingDates.length} más`
                    : ''}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="size-4" />
                No se modifica ni elimina asistencia existente.
              </div>
              <button
                type="submit"
                disabled={!hasChanges || save.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="size-4" />
                {save.isPending ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SemesterFieldset({
  title,
  startId,
  endId,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
}: {
  title: string;
  startId: keyof FormState;
  endId: keyof FormState;
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={startId}>
          Inicio
          <input
            id={startId}
            type="date"
            value={startValue}
            onChange={(event) => onStartChange(event.target.value)}
            className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            required
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={endId}>
          Término
          <input
            id={endId}
            type="date"
            value={endValue}
            onChange={(event) => onEndChange(event.target.value)}
            className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            required
          />
        </label>
      </div>
    </fieldset>
  );
}

function formatRange(from: string, to: string): string {
  if (!from || !to) return 'Sin fechas';
  return `${formatDate(from)} a ${formatDate(to)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

function conflictFromError(
  error: unknown,
): { message: string; conflictingDates: string[]; totalConflicts: number } | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const data = error.data as {
    message?: unknown;
    conflictingDates?: unknown;
    totalConflicts?: unknown;
  };
  if (!data || !Array.isArray(data.conflictingDates)) return null;
  return {
    message:
      typeof data.message === 'string'
        ? data.message
        : 'La configuración dejaría asistencias fuera del año escolar.',
    conflictingDates: data.conflictingDates.filter(
      (date): date is string => typeof date === 'string',
    ),
    totalConflicts:
      typeof data.totalConflicts === 'number' ? data.totalConflicts : data.conflictingDates.length,
  };
}
