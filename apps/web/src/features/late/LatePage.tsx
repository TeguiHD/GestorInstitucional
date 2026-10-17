import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, CheckCircle, type Clock, FileCheck, Search, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { formatStudentFullName } from '@/lib/student-name';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Bandeja de atrasos de Inspectoría. Un atraso pendiente (status LATE) no cuenta
 * como asistencia ni como inasistencia hasta que se resuelve a PRESENT o ABSENT.
 * Ver docs/superpowers/specs/2026-10-17-atrasos-pendientes-design.md.
 */

type LateState = 'pending' | 'resolved';
type Resolution = 'PRESENT' | 'ABSENT';

type LateRecord = {
  id: string;
  date: string;
  status: string;
  lateMinutes: number | null;
  note: string | null;
  updatedAt: string;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    secondLastName: string | null;
    rut: string;
  };
  course: { id: string; code: string; name: string };
};

type PagedResult = { items: LateRecord[]; total: number; limit: number; offset: number };

type Course = { id: string; code: string; name: string };

// Mismas clases de pastilla que STATUS_CONFIG de Justificaciones.
const FINAL_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  PRESENT: {
    label: 'Presente',
    color: 'text-green-600 bg-green-50 dark:bg-green-900/20',
    icon: CheckCircle,
  },
  ABSENT: {
    label: 'Ausente',
    color: 'text-red-600   bg-red-50   dark:bg-red-900/20',
    icon: XCircle,
  },
  JUSTIFIED: {
    label: 'Justificado',
    color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
    icon: FileCheck,
  },
};

const RESOLVER_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'UTP', 'INSPECTORIA'];
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

// Cachés que dependen del estado de un registro de asistencia (grilla, informes,
// estadísticas). Se invalidan por prefijo tras resolver atrasos.
const ATTENDANCE_QUERY_PREFIXES = [
  'course-matrix',
  'attendance-matrix',
  'course-matrix-report',
  'course-summary-report',
  'course-monthly-breakdown',
  'course-month-summary',
  'attendance-month-summary',
  'course-insights',
  'status-review-matrices',
  'student-stats',
  'student-records',
  'school-stats',
  'at-risk',
];

function formatLateDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
}

function confirmText(count: number, status: Resolution): string {
  const noun = count === 1 ? 'atraso' : 'atrasos';
  const target =
    status === 'PRESENT'
      ? count === 1
        ? 'presente'
        : 'presentes'
      : count === 1
        ? 'ausente'
        : 'ausentes';
  return `¿Marcar ${count} ${noun} como ${target}? Esta acción queda registrada en auditoría.`;
}

export function LatePage() {
  const user = useUser();
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();
  const canResolve = user?.roles?.some((r) => RESOLVER_ROLES.includes(r)) ?? false;
  const year = new Date().getFullYear();

  const [tab, setTab] = useState<LateState>('pending');
  const [courseId, setCourseId] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Resolution | null>(null);

  // Cualquier cambio de vista descarta la selección y vuelve a la primera página.
  function resetView() {
    setPage(0);
    setSelected(new Set());
    setConfirm(null);
  }

  useEffect(() => {
    const next = search.trim();
    if (next === debouncedSearch) return;
    const t = setTimeout(() => {
      setDebouncedSearch(next);
      setPage(0);
      setSelected(new Set());
      setConfirm(null);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search, debouncedSearch]);

  const enabled = !!schoolId && canResolve;

  const { data: courses } = useQuery<Course[]>({
    queryKey: ['courses', schoolId, year],
    queryFn: () => api.get(`/courses?schoolId=${encodeURIComponent(schoolId)}&year=${year}`),
    enabled,
  });

  const { data, isLoading, isFetching } = useQuery<PagedResult>({
    queryKey: ['late-attendance', schoolId, tab, courseId, debouncedSearch, page],
    queryFn: () => {
      const params = new URLSearchParams({
        state: tab,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (courseId) params.set('courseId', courseId);
      if (debouncedSearch) params.set('q', debouncedSearch);
      return api.get(`/attendance/late/school/${schoolId}?${params.toString()}`);
    },
    enabled,
    // Mantiene la página anterior mientras carga (búsqueda, paginación), pero no
    // mezcla filas de otra pestaña.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === tab ? prev : undefined),
  });

  const { data: pendingData } = useQuery<PagedResult>({
    queryKey: ['late-attendance', schoolId, 'pending-count'],
    queryFn: () => api.get(`/attendance/late/school/${schoolId}?state=pending&limit=1&offset=0`),
    enabled,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pendingCount = pendingData?.total ?? 0;
  const isPendingTab = tab === 'pending';

  // Solo cuentan los seleccionados visibles: tras un refetch pueden haber
  // desaparecido registros que otra persona ya resolvió.
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['late-attendance', schoolId] });
    for (const key of ATTENDANCE_QUERY_PREFIXES) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const resolve = useMutation({
    mutationFn: ({ recordIds, status }: { recordIds: string[]; status: Resolution }) =>
      api.post<{ resolved: number }>('/attendance/late/resolve', { recordIds, status }),
    onSuccess: (res, vars) => {
      const n = res?.resolved ?? vars.recordIds.length;
      const target =
        vars.status === 'PRESENT'
          ? n === 1
            ? 'presente'
            : 'presentes'
          : n === 1
            ? 'ausente'
            : 'ausentes';
      toast.success(`${n} ${n === 1 ? 'atraso marcado' : 'atrasos marcados'} como ${target}`);
      setSelected(new Set());
      setConfirm(null);
      setPage(0);
      invalidateAll();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['late-attendance', schoolId] });
    },
  });

  function toggleOne(id: string) {
    setConfirm(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setConfirm(null);
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }

  function changePage(next: number) {
    setPage(next);
    setSelected(new Set());
    setConfirm(null);
  }

  const TABS: { key: LateState; label: string }[] = [
    { key: 'pending', label: pendingCount > 0 ? `Pendientes (${pendingCount})` : 'Pendientes' },
    { key: 'resolved', label: 'Resueltos' },
  ];

  const isFiltered = !!courseId || !!debouncedSearch;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Atrasos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Los atrasos pendientes no cuentan como asistencia ni como inasistencia hasta resolverlos.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSearch('');
              setDebouncedSearch('');
              resetView();
            }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors -mb-px ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Alumno o RUT…"
            aria-label="Buscar por alumno o RUT"
            maxLength={80}
            className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            resetView();
          }}
          aria-label="Filtrar por curso"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-56"
        >
          <option value="">Todos los cursos</option>
          {(courses ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk action bar */}
      {isPendingTab && selectedIds.length > 0 && (
        <div className="sticky top-0 z-10 rounded-xl border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-medium">
              {selectedIds.length} {selectedIds.length === 1 ? 'seleccionado' : 'seleccionados'}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => setConfirm(confirm === 'PRESENT' ? null : 'PRESENT')}
                className={`min-h-[36px] flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 sm:flex-none ${
                  confirm === 'PRESENT'
                    ? 'bg-green-600 text-white border-green-600'
                    : 'border-border hover:bg-muted'
                }`}
              >
                ✓ Marcar presente
              </button>
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => setConfirm(confirm === 'ABSENT' ? null : 'ABSENT')}
                className={`min-h-[36px] flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 sm:flex-none ${
                  confirm === 'ABSENT'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'border-border hover:bg-muted'
                }`}
              >
                ✗ Marcar ausente
              </button>
            </div>
          </div>

          {/* Inline confirmation */}
          {confirm && (
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              <p className="text-sm">{confirmText(selectedIds.length, confirm)}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={resolve.isPending}
                  onClick={() => setConfirm(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ recordIds: selectedIds, status: confirm })}
                  className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {resolve.isPending ? 'Guardando…' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {!schoolId ? (
        <EmptyState
          icon={AlarmClock}
          title="Sin colegio asignado"
          description="Tu cuenta no está vinculada a un colegio."
        />
      ) : !canResolve ? (
        <EmptyState
          icon={AlarmClock}
          title="Sin acceso"
          description="Solo Inspectoría, UTP y Dirección pueden resolver atrasos."
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 animate-pulse bg-muted rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={AlarmClock}
          title="Sin atrasos"
          description={
            isFiltered
              ? 'Ningún atraso coincide con los filtros.'
              : isPendingTab
                ? 'No hay atrasos pendientes de resolver.'
                : 'Aún no hay atrasos resueltos.'
          }
        />
      ) : (
        <div
          className={`rounded-xl border border-border bg-background overflow-hidden transition-opacity ${
            isFetching ? 'opacity-70' : ''
          }`}
          key={`${tab}-${page}`}
        >
          {/* List header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
            {isPendingTab && (
              <input
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={resolve.isPending}
                aria-label="Seleccionar todos en esta página"
                title="Seleccionar todos en esta página"
                className="size-4 shrink-0 accent-primary cursor-pointer"
              />
            )}
            <span className="flex-1">Alumno</span>
            <span className="hidden sm:block w-28 text-right">Fecha</span>
          </div>

          <ul className="divide-y divide-border">
            {items.map((r) => {
              const name = formatStudentFullName(r.student);
              const isChecked = selected.has(r.id);
              const cfg = FINAL_STATUS_CONFIG[r.status];
              const Icon = cfg?.icon;
              const content = (
                <>
                  {isPendingTab && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleOne(r.id)}
                      disabled={resolve.isPending}
                      aria-label={`Seleccionar atraso de ${name} del ${formatLateDate(r.date)}`}
                      className="size-4 shrink-0 accent-primary cursor-pointer"
                    />
                  )}
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{name}</span>
                    <span className="text-xs text-muted-foreground">{r.student.rut}</span>
                    <span
                      className="text-xs bg-muted px-2 py-0.5 rounded-full"
                      title={r.course.name}
                    >
                      {r.course.code}
                    </span>
                    {!isPendingTab && cfg && Icon && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${cfg.color}`}
                      >
                        <Icon className="h-3 w-3" /> {cfg.label}
                      </span>
                    )}
                    <span className="sm:hidden text-xs text-muted-foreground capitalize">
                      {formatLateDate(r.date)}
                    </span>
                  </div>
                  <span className="hidden sm:block w-28 text-right text-xs text-muted-foreground tabular-nums capitalize">
                    {formatLateDate(r.date)}
                  </span>
                </>
              );
              return (
                <li key={r.id}>
                  {isPendingTab ? (
                    <label
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/40 ${
                        isChecked ? 'bg-primary/5' : ''
                      }`}
                    >
                      {content}
                    </label>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-2.5">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {total} resultados · pág. {page + 1} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => changePage(page - 1)}
              className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted transition-colors"
            >
              ← Anterior
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => changePage(page + 1)}
              className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
