import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Send, Snowflake, Sun, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { cn } from '@/lib/cn';

import {
  getVacationBanners,
  getVacationInfo,
  type AcademicYearConfig,
} from './calendar-vacations.logic';
import { buildRangeDayKeys } from './calendar-range.logic';

type DayType = 'HOLIDAY' | 'SUSPENDED' | 'EVENT';
type CalendarDay = { id: string; date: string; type: DayType; description: string };

const TYPE_STYLE: Record<DayType, { label: string; cls: string; dot: string }> = {
  HOLIDAY: {
    label: 'Feriado',
    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    dot: 'bg-red-500',
  },
  SUSPENDED: {
    label: 'Suspendido',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  EVENT: {
    label: 'Evento',
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
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
const DOW_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function buildGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0).getDate();
  // es-CL week starts Monday. getDay() 0=Sun→6, 1=Mon→0
  const startDow = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = Array.from({ length: startDow }, () => null);
  for (let d = 1; d <= last; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function CalendarPage() {
  const user = useUser();
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [form, setForm] = useState({
    date: '',
    dateTo: '',
    type: 'HOLIDAY' as DayType,
    description: '',
    notify: false,
  });
  const [focusDay, setFocusDay] = useState<CalendarDay | null>(null);

  const { data: days, isLoading } = useQuery<CalendarDay[]>({
    queryKey: ['calendar', schoolId, year],
    queryFn: () => api.get(`/calendar/school/${schoolId}?year=${year}`),
    enabled: !!schoolId,
  });

  // Config de semestres para derivar vacaciones (misma fuente que reportes/asistencia).
  // Sin retry ni toast: si falla, la página se ve exactamente como antes.
  const { data: academicYear } = useQuery<AcademicYearConfig>({
    queryKey: ['school-academic-year-config', schoolId, year],
    queryFn: () => api.get(`/school-config/${schoolId}/academic-year/${year}`),
    enabled: !!schoolId,
    staleTime: 1000 * 60 * 60,
    retry: false,
  });

  const dayMap = useMemo(() => {
    const m = new Map<string, CalendarDay>();
    days?.forEach((d) => m.set(d.date.split('T')[0]!, d));
    return m;
  }, [days]);

  const grid = useMemo(() => buildGrid(year, month), [year, month]);

  const prevMonth = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  };

  const createMut = useMutation({
    mutationFn: async () => {
      // Día único: comportamiento original intacto (incluye notify).
      if (!form.dateTo) {
        await api.post('/calendar', {
          schoolId,
          date: form.date,
          type: form.type,
          description: form.description,
          notify: form.notify,
        });
        return { single: true, created: 1, skippedExisting: 0, skippedWeekends: 0, failed: 0 };
      }

      const plan = buildRangeDayKeys(form.date, form.dateTo, new Set(dayMap.keys()));
      if (!plan.ok) {
        throw new Error(
          plan.error === 'RANGE_TOO_LARGE'
            ? 'El rango no puede superar 60 días'
            : 'Rango inválido: "Hasta" debe ser posterior a "Desde" y del mismo año',
        );
      }

      let created = 0;
      let failed = 0;
      // Secuencial a propósito: orden estable y sin ráfaga contra la API.
      for (const date of plan.create) {
        try {
          await api.post('/calendar', {
            schoolId,
            date,
            type: form.type,
            description: form.description,
            notify: false,
          });
          created += 1;
        } catch {
          failed += 1;
        }
      }
      return {
        single: false,
        created,
        skippedExisting: plan.skippedExisting.length,
        skippedWeekends: plan.skippedWeekends,
        failed,
      };
    },
    onSuccess: (r) => {
      if (r.single) {
        toast.success(form.notify ? 'Día guardado · avisos en cola' : 'Día guardado');
      } else {
        const parts = [
          `${r.created} día${r.created !== 1 ? 's' : ''} guardado${r.created !== 1 ? 's' : ''}`,
        ];
        if (r.skippedExisting > 0) {
          parts.push(
            `${r.skippedExisting} omitido${r.skippedExisting !== 1 ? 's' : ''} (ya existía${r.skippedExisting !== 1 ? 'n' : ''})`,
          );
        }
        if (r.skippedWeekends > 0) parts.push('fines de semana excluidos');
        if (r.failed > 0) {
          toast.warning(`${parts.join(' · ')} · ${r.failed} con error`);
        } else {
          toast.success(parts.join(' · '));
        }
      }
      setForm({ date: '', dateTo: '', type: 'HOLIDAY', description: '', notify: false });
      void qc.invalidateQueries({ queryKey: ['calendar', schoolId] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const notifyMut = useMutation({
    mutationFn: (id: string) =>
      api.post<{ enqueued: number; deduped: number }>(`/calendar/${id}/notify`, {}),
    onSuccess: (r) => toast.success(`Avisos encolados: ${r.enqueued} (${r.deduped} duplicados)`),
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const seedMut = useMutation({
    mutationFn: () => api.post<{ seeded: number }>('/calendar/seed-chile', { schoolId, year }),
    onSuccess: (r) => {
      toast.success(`${r.seeded} feriados cargados para ${year}`);
      void qc.invalidateQueries({ queryKey: ['calendar', schoolId] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.del(`/calendar/${id}`),
    onSuccess: () => {
      toast.success('Eliminado');
      setFocusDay(null);
      void qc.invalidateQueries({ queryKey: ['calendar', schoolId] });
    },
  });

  const canEdit = user?.roles.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP'].includes(r));

  const handleDayClick = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existing = dayMap.get(dateStr);
    if (existing) {
      setFocusDay(existing);
    } else if (canEdit) {
      setForm((f) => ({ ...f, date: dateStr }));
    }
  };

  const monthDays =
    days?.filter((d) => {
      const dt = new Date(d.date.split('T')[0]! + 'T12:00');
      return dt.getFullYear() === year && dt.getMonth() === month;
    }) ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendario escolar</h1>
          <p className="text-sm text-muted-foreground">Feriados, días suspendidos y eventos</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
          >
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {canEdit && (
            <button
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
              className="text-sm px-3 py-1.5 rounded-lg border hover:bg-muted disabled:opacity-50"
            >
              {seedMut.isPending ? 'Cargando…' : `Feriados Chile ${year}`}
            </button>
          )}
        </div>
      </div>

      {/* Month grid */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <button
            onClick={prevMonth}
            className="size-7 rounded-lg border flex items-center justify-center hover:bg-muted transition"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="flex-1 text-center text-sm font-semibold">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="size-7 rounded-lg border flex items-center justify-center hover:bg-muted transition"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <div className="p-3">
          {/* DOW headers */}
          <div className="grid grid-cols-7 mb-1">
            {DOW_SHORT.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] font-semibold text-muted-foreground py-1"
              >
                {d}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px">
            {grid.map((day, i) => {
              if (!day) return <div key={i} />;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const special = dayMap.get(dateStr);
              const vacation = !special ? getVacationInfo(dateStr, academicYear) : null;
              const isToday =
                year === today.getFullYear() &&
                month === today.getMonth() &&
                day === today.getDate();
              const dow = i % 7; // 0=Mon, 5=Sat, 6=Sun
              const isWeekend = dow >= 5;

              return (
                <button
                  key={i}
                  onClick={() => handleDayClick(day)}
                  title={vacation?.label}
                  className={cn(
                    'relative flex flex-col items-center rounded-lg py-1.5 px-1 text-xs transition select-none',
                    vacation
                      ? 'bg-muted/60 text-muted-foreground/50'
                      : isWeekend && !special
                        ? 'text-muted-foreground/60'
                        : 'text-foreground',
                    special ? 'font-semibold' : '',
                    isToday ? 'ring-2 ring-primary ring-offset-1' : '',
                    canEdit || special ? 'cursor-pointer hover:bg-muted' : 'cursor-default',
                  )}
                >
                  <span
                    className={cn(
                      'size-6 flex items-center justify-center rounded-full',
                      isToday ? 'bg-primary text-primary-foreground' : '',
                    )}
                  >
                    {day}
                  </span>
                  {special && (
                    <span
                      className={cn('size-1.5 rounded-full mt-0.5', TYPE_STYLE[special.type].dot)}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border">
          {Object.entries(TYPE_STYLE).map(([t, cfg]) => (
            <div key={t} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('size-2 rounded-full', cfg.dot)} />
              {cfg.label}
            </div>
          ))}
          {academicYear && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-[3px] border border-border bg-muted" />
              Vacaciones
            </div>
          )}
        </div>
      </div>

      {/* Vacaciones del mes (derivadas de semestres — no son entradas de BD) */}
      {(() => {
        const pad = (n: number) => String(n).padStart(2, '0');
        const monthStartKey = `${year}-${pad(month + 1)}-01`;
        const monthEndKey = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
        const fmtKey = (key: string, opts: Intl.DateTimeFormatOptions) =>
          new Date(`${key}T12:00`).toLocaleDateString('es-CL', opts);
        const banners = getVacationBanners(year, academicYear).filter(
          (b) => b.from <= monthEndKey && b.to >= monthStartKey,
        );
        if (banners.length === 0) return null;
        return (
          <div className="space-y-2">
            {banners.map((b) => (
              <div
                key={`${b.kind}-${b.from}`}
                className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3"
              >
                {b.kind === 'winter' ? (
                  <Snowflake className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Sun className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {b.label} — {fmtKey(b.from, { day: 'numeric', month: 'short' })} al{' '}
                    {fmtKey(b.to, { day: 'numeric', month: 'short' })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Según configuración de semestres · sin clases, no afecta la asistencia
                    {b.returnDate
                      ? ` · retorno ${fmtKey(b.returnDate, { weekday: 'long', day: 'numeric', month: 'long' })}`
                      : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Month list */}
      {monthDays.length > 0 && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Días especiales — {MONTH_NAMES[month]}</h2>
          </div>
          <div className="data-scroll">
            <table className="w-full text-sm">
              <tbody>
                {monthDays.map((d) => {
                  const dt = new Date(d.date.split('T')[0]! + 'T12:00');
                  const cfg = TYPE_STYLE[d.type];
                  return (
                    <tr key={d.id} className="border-t border-border hover:bg-muted/20 transition">
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground w-28">
                        {dt.toLocaleDateString('es-CL', {
                          day: '2-digit',
                          month: 'short',
                          weekday: 'short',
                        })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cfg.cls}`}
                        >
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{d.description}</td>
                      {canEdit && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => notifyMut.mutate(d.id)}
                              disabled={notifyMut.isPending}
                              className="text-muted-foreground hover:text-primary transition disabled:opacity-50"
                              title="Avisar apoderados"
                            >
                              <Send className="size-3.5" />
                            </button>
                            <button
                              onClick={() => delMut.mutate(d.id)}
                              className="text-muted-foreground hover:text-destructive transition"
                              title="Eliminar"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add form */}
      {canEdit && (
        <div className="rounded-xl border border-border bg-background p-4 space-y-3">
          <h2 className="text-sm font-semibold">Agregar día especial</h2>
          <div className="grid sm:grid-cols-5 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Desde
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Hasta (opcional)
              </label>
              <input
                type="date"
                value={form.dateTo}
                min={form.date || undefined}
                onChange={(e) => setForm({ ...form, dateTo: e.target.value, notify: false })}
                className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
              />
            </div>
            <div className="flex flex-col gap-1 justify-end">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as DayType })}
                className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
              >
                <option value="HOLIDAY">Feriado</option>
                <option value="SUSPENDED">Día suspendido</option>
                <option value="EVENT">Evento</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 justify-end sm:col-span-2">
              <input
                placeholder="Descripción"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
              />
            </div>
          </div>
          {form.dateTo && (
            <p className="text-xs text-muted-foreground">
              Se creará un día por cada día hábil del rango; se omiten fines de semana y fechas que
              ya tienen entrada.
            </p>
          )}
          <label
            className={cn(
              'flex items-center gap-2 text-sm',
              form.dateTo ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            <input
              type="checkbox"
              checked={!form.dateTo && form.notify}
              disabled={!!form.dateTo}
              onChange={(e) => setForm({ ...form, notify: e.target.checked })}
              className="rounded"
            />
            Avisar a apoderados por correo{form.dateTo ? ' (solo para día único)' : ''}
          </label>
          <button
            onClick={() => createMut.mutate()}
            disabled={!form.date || !form.description || createMut.isPending}
            className="text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {createMut.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}

      {/* Full year list (all months) */}
      {!isLoading && days && days.length > 0 && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Año completo {year}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3 w-32">Fecha</th>
                  <th className="text-left px-4 py-3 w-28">Tipo</th>
                  <th className="text-left px-4 py-3">Descripción</th>
                  {canEdit && <th className="w-16" />}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const dt = new Date(d.date.split('T')[0]! + 'T12:00');
                  const cfg = TYPE_STYLE[d.type];
                  return (
                    <tr key={d.id} className="border-t border-border hover:bg-muted/20 transition">
                      <td className="px-4 py-2 tabular-nums">
                        {dt.toLocaleDateString('es-CL', {
                          day: '2-digit',
                          month: 'short',
                          weekday: 'short',
                        })}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cfg.cls}`}
                        >
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2">{d.description}</td>
                      {canEdit && (
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => notifyMut.mutate(d.id)}
                              disabled={notifyMut.isPending}
                              className="text-muted-foreground hover:text-primary transition disabled:opacity-50"
                              title="Avisar apoderados"
                            >
                              <Send className="size-3.5" />
                            </button>
                            <button
                              onClick={() => delMut.mutate(d.id)}
                              className="text-muted-foreground hover:text-destructive transition"
                              title="Eliminar"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Day detail modal */}
      {focusDay && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setFocusDay(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background rounded-xl border border-border w-full max-w-sm p-5 space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">
                  {new Date(focusDay.date.split('T')[0]! + 'T12:00').toLocaleDateString('es-CL', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </p>
                <span
                  className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${TYPE_STYLE[focusDay.type].cls}`}
                >
                  {TYPE_STYLE[focusDay.type].label}
                </span>
              </div>
              <button
                onClick={() => setFocusDay(null)}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
              >
                ×
              </button>
            </div>
            <p className="text-sm">{focusDay.description}</p>
            {canEdit && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => notifyMut.mutate(focusDay.id)}
                  disabled={notifyMut.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border hover:bg-muted disabled:opacity-50"
                >
                  <Send className="size-3.5" /> Avisar apoderados
                </button>
                <button
                  onClick={() => delMut.mutate(focusDay.id)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
