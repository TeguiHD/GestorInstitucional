# Profesionalización Radical — Asistencia CSSP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar Asistencia CSSP de "control de asistencia visual" a "sistema de gestión + análisis + comunicación + cumplimiento" vendible a colegios chilenos.

**Architecture:** Sistema monorepo NestJS + React ya maduro. Las mejoras se organizan en 4 sprints independientes y desplegables. Cada sprint entrega valor standalone. No romper lo que ya funciona — extender y mejorar.

**Tech Stack:** NestJS 10 + Fastify, Prisma + MariaDB 11, React 19 + TanStack Router/Query, Tailwind v4, Recharts, Brevo (mail), Twilio (WhatsApp), View Transitions API, QR (qrcode + jsQR), Claude API (IA narrativa), pnpm workspaces + Turborepo.

---

## Estado actual (no tocar — ya funciona)

✅ Auth JWT + TOTP 2FA · ✅ Cursos + Alumnos CRUD · ✅ Registro asistencia · ✅ Reportes Excel · ✅ Insights analytics · ✅ Calendario · ✅ Justificaciones (backend) · ✅ Mail Brevo · ✅ Audit logs · ✅ Alertas automáticas cron · ✅ Dashboards Director/Profesor · ✅ Usuarios CRUD + roles · ✅ Dark mode + paleta CSSP · ✅ Rutas español · ✅ Favicon + manifest PWA

---

## SPRINT A — Visual & UX de clase mundial

> Duración estimada: 2-3 días. Lo que ve el usuario primero — impresión decisiva.

### Archivos a modificar/crear (Sprint A)

| Archivo                                                       | Acción                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/web/src/lib/theme.ts`                                   | Modificar: agregar `startViewTransition` wrapper            |
| `apps/web/src/components/ui/ThemeToggle.tsx`                  | Modificar: usar View Transition API                         |
| `apps/web/src/index.css`                                      | Agregar: `@keyframes scale` + `::view-transition-*`         |
| `apps/web/src/features/justifications/JustificationsPage.tsx` | Modificar: agregar upload inline, timeline estado, filtros  |
| `apps/web/src/routes/_auth.justificaciones.tsx`               | Verificar: no cambios                                       |
| `apps/web/src/features/courses/CourseDetailPage.tsx`          | Modificar: botones más grandes, swipe gestures, modo rápido |
| `apps/web/src/features/students/StudentDetailPage.tsx`        | Modificar: timeline 30 días visual (calendar grid)          |
| `apps/web/src/index.css`                                      | Modificar: audit contraste, fix --color-muted-foreground    |
| `apps/web/public/logo-cssp.svg`                               | Reemplazar: logo CSSP institucional real                    |

---

### Task A1: Theme toggle — animación círculo (View Transitions API)

**Files:**

- Modify: `apps/web/src/index.css`
- Modify: `apps/web/src/components/ui/ThemeToggle.tsx`
- Modify: `apps/web/src/lib/theme.ts`

- [ ] **Step 1: Agregar CSS View Transitions a index.css**

Agregar al final de `apps/web/src/index.css`:

```css
/* Theme toggle — circle reveal animation */
::view-transition-new(root) {
  mask: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="white"/></svg>')
    center / 0 no-repeat;
  animation: cssp-theme-scale 0.8s ease-in-out;
  animation-fill-mode: both;
}

::view-transition-old(root),
.dark::view-transition-old(root) {
  animation: none;
  animation-fill-mode: both;
  z-index: -1;
}

.dark::view-transition-new(root) {
  animation: cssp-theme-scale 0.8s ease-in-out;
  animation-fill-mode: both;
}

@keyframes cssp-theme-scale {
  to {
    mask-size: 200vmax;
  }
}

/* Disable animation for reduced-motion preference */
@media (prefers-reduced-motion: reduce) {
  ::view-transition-new(root),
  .dark::view-transition-new(root) {
    animation: none;
  }
}
```

- [ ] **Step 2: Modificar ThemeToggle para usar startViewTransition**

Leer `apps/web/src/components/ui/ThemeToggle.tsx` completo, luego reemplazar el handler del toggle:

```tsx
// En ThemeToggle.tsx — wrap el cambio de tema con View Transition
function applyThemeWithTransition(callback: () => void) {
  if (!document.startViewTransition) {
    callback();
    return;
  }
  document.startViewTransition(callback);
}

// Donde se llame a setTheme(...), envolver:
applyThemeWithTransition(() => setTheme(newTheme));
```

- [ ] **Step 3: Verificar en browser que la animación funciona**

```bash
pnpm --filter @asistencia/web dev
# Navegar a cualquier página → hacer click en toggle → verificar animación círculo
# Verificar que prefers-reduced-motion la desactiva
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @asistencia/web exec tsc --noEmit
# Expected: sin errores
```

---

### Task A2: Justificaciones — UI completa y profesional

**Files:**

- Modify: `apps/web/src/features/justifications/JustificationsPage.tsx`

La JustificationsPage actual muestra solo "pendientes" con approve/reject. Necesita:

- Tabs: Pendientes | Aprobadas | Rechazadas | Todas
- Timeline visual del estado por justificación
- Preview del documento inline (no solo download link)
- Filtro por curso, alumno, fecha
- Contador badge en el tab Pendientes

- [ ] **Step 1: Leer el archivo actual**

```bash
cat apps/web/src/features/justifications/JustificationsPage.tsx
```

- [ ] **Step 2: Reescribir con tabs y filtros**

Reemplazar el componente con:

```tsx
// apps/web/src/features/justifications/JustificationsPage.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle, Clock, Download, FileText, XCircle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useUser } from '@/stores/auth.store';
import { EmptyState } from '@/components/ui/EmptyState';

type JustStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type Justification = {
  id: string;
  status: JustStatus;
  reason: string;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  attendance: {
    date: string;
    student: { id: string; firstName: string; lastName: string; rut: string };
    course: { code: string; name: string };
  };
  reviewer: { firstName: string; lastName: string } | null;
};

const STATUS_CONFIG: Record<JustStatus, { label: string; color: string; icon: typeof Clock }> = {
  PENDING: {
    label: 'Pendiente',
    color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
    icon: Clock,
  },
  APPROVED: {
    label: 'Aprobada',
    color: 'text-green-600 bg-green-50 dark:bg-green-900/20',
    icon: CheckCircle,
  },
  REJECTED: {
    label: 'Rechazada',
    color: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    icon: XCircle,
  },
};

export function JustificationsPage() {
  const user = useUser();
  const qc = useQueryClient();
  const schoolId = user?.schoolId ?? '';
  const canReview =
    user?.roles?.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP'].includes(r)) ?? false;

  const [tab, setTab] = useState<JustStatus | 'ALL'>('PENDING');
  const [search, setSearch] = useState('');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [notes, setNotes] = useState('');

  const { data: pending = [] } = useQuery<Justification[]>({
    queryKey: ['justifications', schoolId, 'PENDING'],
    queryFn: () => api.get(`/justifications/school/${schoolId}/pending`),
    enabled: !!schoolId,
  });

  const { data: all = [], isLoading } = useQuery<Justification[]>({
    queryKey: ['justifications', schoolId, 'all'],
    queryFn: () => api.get(`/justifications/school/${schoolId}`),
    enabled: !!schoolId,
  });

  const review = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      api.patch(`/justifications/${id}/review`, { status, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['justifications', schoolId] });
      toast.success('Justificación revisada');
      setReviewId(null);
      setDecision(null);
      setNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const displayed = (tab === 'ALL' ? all : all.filter((j) => j.status === tab)).filter((j) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${j.attendance.student.firstName} ${j.attendance.student.lastName}`.toLowerCase();
    return (
      name.includes(q) ||
      j.attendance.student.rut.includes(q) ||
      j.attendance.course.code.toLowerCase().includes(q)
    );
  });

  const TABS: { key: JustStatus | 'ALL'; label: string }[] = [
    { key: 'PENDING', label: `Pendientes${pending.length ? ` (${pending.length})` : ''}` },
    { key: 'APPROVED', label: 'Aprobadas' },
    { key: 'REJECTED', label: 'Rechazadas' },
    { key: 'ALL', label: 'Todas' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Justificaciones</h1>
        <p className="text-sm text-muted-foreground mt-1">Certificados enviados por apoderados</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar alumno, RUT o curso…"
          className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2 text-sm"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse bg-muted rounded-xl" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Sin justificaciones"
          description={
            tab === 'PENDING'
              ? 'No hay certificados pendientes de revisión.'
              : 'Sin registros en esta categoría.'
          }
        />
      ) : (
        <div className="space-y-3">
          {displayed.map((j) => {
            const cfg = STATUS_CONFIG[j.status];
            const Icon = cfg.icon;
            const isReviewing = reviewId === j.id;
            return (
              <div key={j.id} className="rounded-xl border border-border bg-background p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        {j.attendance.student.lastName}, {j.attendance.student.firstName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {j.attendance.student.rut}
                      </span>
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                        {j.attendance.course.code}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${cfg.color}`}
                      >
                        <Icon className="h-3 w-3" /> {cfg.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ausencia:{' '}
                      <strong>
                        {new Date(j.attendance.date + 'T12:00').toLocaleDateString('es-CL')}
                      </strong>
                      {' · '}Enviada: {new Date(j.createdAt).toLocaleDateString('es-CL')}
                      {j.reviewer &&
                        ` · Revisada por ${j.reviewer.firstName} ${j.reviewer.lastName}`}
                    </p>
                    <p className="text-sm mt-2">{j.reason}</p>
                    {j.notes && (
                      <p className="text-xs text-muted-foreground mt-1 italic">Nota: {j.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={`${import.meta.env.VITE_API_BASE_URL}/justifications/${j.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" /> Ver
                    </a>
                    {canReview && j.status === 'PENDING' && (
                      <button
                        onClick={() => {
                          setReviewId(isReviewing ? null : j.id);
                          setDecision(null);
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        Revisar
                      </button>
                    )}
                  </div>
                </div>
                {/* Inline review panel */}
                {isReviewing && (
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    <div className="flex gap-2">
                      {(['APPROVED', 'REJECTED'] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() => setDecision(d)}
                          className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                            decision === d
                              ? d === 'APPROVED'
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-red-600 text-white border-red-600'
                              : 'border-border hover:bg-muted'
                          }`}
                        >
                          {d === 'APPROVED' ? '✓ Aprobar' : '✗ Rechazar'}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Nota opcional para el apoderado…"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm h-20 resize-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setReviewId(null)}
                        className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted"
                      >
                        Cancelar
                      </button>
                      <button
                        disabled={!decision || review.isPending}
                        onClick={() =>
                          decision &&
                          review.mutate({ id: j.id, status: decision, notes: notes || undefined })
                        }
                        className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {review.isPending ? 'Guardando…' : 'Confirmar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar que el endpoint `GET /justifications/school/:id` existe**

```bash
grep -n "school\|pendingBySchool\|listBySchool" apps/api/src/justifications/justifications.controller.ts
```

Si no existe ruta `GET /justifications/school/:schoolId`, agregar en controller:

```typescript
@Get('school/:schoolId')
@Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
listBySchool(@Param('schoolId') schoolId: string) {
  return this.justifications.listBySchool(schoolId);
}
```

Y en service:

```typescript
async listBySchool(schoolId: string) {
  return this.prisma.justification.findMany({
    where: { attendance: { course: { schoolId } } },
    include: {
      attendance: { include: { student: { select: { id:true, firstName:true, lastName:true, rut:true } }, course: { select: { code:true, name:true } } } },
      uploadedBy: { select: { firstName:true, lastName:true } },
      reviewedBy: { select: { firstName:true, lastName:true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
```

- [ ] **Step 4: Typecheck + build**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
pnpm --filter @asistencia/web exec tsc --noEmit
# Expected: sin errores
```

---

### Task A3: Contraste WCAG AA — fix colores problemáticos

**Files:**

- Modify: `apps/web/src/index.css`

El `--color-muted-foreground` en light mode es `#595959` (contraste 7:1 sobre blanco = AAA ✓).
El `--color-muted-foreground` en dark mode necesita verificación.

- [ ] **Step 1: Auditar tokens actuales**

En `apps/web/src/index.css`, verificar:

- Light: `--color-muted-foreground: #595959` → sobre `#FFFFFF` = 7.0:1 ✓ AAA
- Dark: `--color-muted-foreground: #B8C5C0` → sobre `#0F1614` = medir en https://webaim.org

- [ ] **Step 2: Actualizar tokens si no pasan AA**

```css
/* En :root.dark — ajustar si contraste < 4.5:1 */
--color-muted-foreground: #a8bab5; /* verificar > 4.5:1 sobre #0F1614 */
```

- [ ] **Step 3: Fix badges hardcoded que usan colores raw**

Buscar y reemplazar en todos los componentes:

```bash
grep -rn "text-green-700\|text-red-700\|text-amber-700\|text-blue-700" apps/web/src/
# Verificar que cada uno tenga suficiente contraste en su fondo
```

---

### Task A4: Mobile UX — Pasar lista optimizado para sala de clases

**Files:**

- Modify: `apps/web/src/features/courses/CourseDetailPage.tsx`

El problema: en mobile, los botones de estado son pequeños. Profesores pasan lista en sala con celular.

- [ ] **Step 1: Leer CourseDetailPage.tsx líneas 250-350 (sección roster)**

```bash
sed -n '250,350p' apps/web/src/features/courses/CourseDetailPage.tsx
```

- [ ] **Step 2: Mejorar touch targets en student roster**

Encontrar el componente de fila de alumno y aumentar el área de toque. Patrón actual:

```tsx
// Probablemente algo como:
<button onClick={cycle}>{status}</button>
```

Reemplazar con botones grandes táctiles:

```tsx
// Botón de estado más grande (min 44×44px según Apple HIG)
<button
  onClick={cycle}
  className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-sm font-semibold transition-all active:scale-95"
  style={{ backgroundColor: statusBg, color: statusText }}
>
  {STATUS_SYMBOLS[status]}
</button>
```

- [ ] **Step 3: Agregar "modo rápido" — tap = PRESENTE, long-press = menu**

En CourseDetailPage, agregar `onPointerDown` con timer de 500ms para long-press. Si long-press → mostrar bottom sheet con las 4 opciones. Si tap normal → marcar PRESENTE directamente.

```tsx
function useAttendanceTap(onTap: () => void, onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  return {
    onPointerDown: () => {
      timer.current = setTimeout(onLongPress, 500);
    },
    onPointerUp: () => {
      clearTimeout(timer.current);
    },
    onPointerLeave: () => clearTimeout(timer.current),
    onClick: onTap,
  };
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @asistencia/web exec tsc --noEmit
```

---

## SPRINT B — Analytics BI Dashboard

> Duración estimada: 3-4 días. Lo que vende a directivos.

### Archivos a modificar/crear (Sprint B)

| Archivo                                                            | Acción                                     |
| ------------------------------------------------------------------ | ------------------------------------------ |
| `apps/web/src/features/dashboard/DirectorDashboard.tsx`            | Agregar: tendencias 30d, heatmap día×curso |
| `apps/web/src/features/dashboard/components/AttendanceHeatmap.tsx` | Crear                                      |
| `apps/web/src/features/dashboard/components/TrendChart.tsx`        | Crear                                      |
| `apps/web/src/features/dashboard/components/RiskPredictor.tsx`     | Crear                                      |
| `apps/api/src/insights/insights.controller.ts`                     | Agregar endpoint trends                    |
| `apps/api/src/insights/insights.service.ts`                        | Agregar: weeklyTrends, predictRisk         |
| `apps/web/src/features/guardian/MisPupilosPage.tsx`                | Mejorar: timeline 30d calendar             |

---

### Task B1: Heatmap de asistencia (día de semana × curso)

**Files:**

- Create: `apps/web/src/features/dashboard/components/AttendanceHeatmap.tsx`
- Modify: `apps/web/src/features/dashboard/DirectorDashboard.tsx`
- Modify: `apps/api/src/insights/insights.service.ts`
- Modify: `apps/api/src/insights/insights.controller.ts`

El heatmap muestra: eje X = día semana (Lun-Vie), eje Y = curso, color = % asistencia.
Insight accionable: "Los lunes 1°B tiene 65% — verificar por qué".

- [ ] **Step 1: Agregar endpoint `GET /insights/school/:id/heatmap`**

En `insights.service.ts` agregar:

```typescript
async getWeekdayHeatmap(schoolId: string, year: number, month: number) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);

  const records = await this.prisma.attendanceRecord.findMany({
    where: {
      course: { schoolId, active: true },
      date: { gte: from, lte: to },
    },
    select: {
      date: true, status: true,
      course: { select: { code: true } },
    },
  });

  // Agrupar por curso × día semana
  const matrix: Record<string, Record<number, { total: number; present: number }>> = {};
  const PRESENT = new Set(['PRESENT', 'LATE']);

  for (const r of records) {
    const dow = new Date(r.date).getDay(); // 0=Sun..6=Sat
    if (dow === 0 || dow === 6) continue;
    matrix[r.course.code] ??= {};
    matrix[r.course.code][dow] ??= { total: 0, present: 0 };
    matrix[r.course.code][dow].total++;
    if (PRESENT.has(r.status)) matrix[r.course.code][dow].present++;
  }

  return Object.entries(matrix).map(([course, days]) => ({
    course,
    days: [1,2,3,4,5].map(d => ({
      dow: d,
      rate: days[d] ? days[d].present / days[d].total : null,
    })),
  }));
}
```

En `insights.controller.ts` agregar:

```typescript
@Get('school/:schoolId/heatmap')
@Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
getHeatmap(
  @Param('schoolId') schoolId: string,
  @Query('year') year: number,
  @Query('month') month: number,
) {
  return this.insights.getWeekdayHeatmap(schoolId, +year, +month);
}
```

- [ ] **Step 2: Crear componente AttendanceHeatmap**

```tsx
// apps/web/src/features/dashboard/components/AttendanceHeatmap.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type HeatRow = { course: string; days: { dow: number; rate: number | null }[] };
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];

function rateToColor(rate: number | null): string {
  if (rate === null) return 'bg-muted';
  if (rate >= 0.9) return 'bg-green-500';
  if (rate >= 0.8) return 'bg-yellow-400';
  if (rate >= 0.7) return 'bg-orange-400';
  return 'bg-red-500';
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
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left pr-3 py-1 text-muted-foreground font-medium">Curso</th>
              {DAYS.map((d) => (
                <th key={d} className="w-14 text-center text-muted-foreground font-medium">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.course}>
                <td className="pr-3 py-1 font-medium text-foreground">{row.course}</td>
                {row.days.map((cell) => (
                  <td key={cell.dow} className="py-1 px-1">
                    <div
                      title={cell.rate !== null ? `${(cell.rate * 100).toFixed(1)}%` : 'Sin datos'}
                      className={`h-8 rounded flex items-center justify-center text-white text-xs font-semibold ${rateToColor(cell.rate)}`}
                    >
                      {cell.rate !== null ? `${(cell.rate * 100).toFixed(0)}%` : '—'}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-green-500 inline-block" /> ≥90%
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-yellow-400 inline-block" /> 80-89%
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-orange-400 inline-block" /> 70-79%
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-red-500 inline-block" /> &lt;70%
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Integrar en DirectorDashboard**

En `DirectorDashboard.tsx`, importar `AttendanceHeatmap` y agregarlo entre el chart de barras y la tabla ranking:

```tsx
import { AttendanceHeatmap } from './components/AttendanceHeatmap';
// ...dentro del return, después del BarChart:
<AttendanceHeatmap schoolId={schoolId} year={year} month={month} />;
```

- [ ] **Step 4: Typecheck + build**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
pnpm --filter @asistencia/web exec tsc --noEmit
```

---

### Task B2: Predicción riesgo repitencia (slope 4 semanas)

**Files:**

- Modify: `apps/api/src/insights/insights.service.ts`
- Modify: `apps/api/src/insights/insights.controller.ts`
- Create: `apps/web/src/features/dashboard/components/RiskPredictor.tsx`

Algoritmo: calcular slope de asistencia últimas 4 semanas. Si rate < 85% AND slope negativo → "riesgo repitencia".

- [ ] **Step 1: Agregar endpoint `GET /insights/school/:id/risk-prediction`**

```typescript
// En insights.service.ts
async getRiskPrediction(schoolId: string) {
  const now = new Date();
  // 4 semanas de datos
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const end = new Date(now); end.setDate(end.getDate() - i * 7);
    const start = new Date(end); start.setDate(start.getDate() - 6);
    return { start, end, week: 4 - i };
  }).reverse();

  const students = await this.prisma.student.findMany({
    where: { schoolId, active: true },
    select: { id: true, firstName: true, lastName: true, rut: true,
      enrollments: { where: { active: true }, select: { course: { select: { id: true, code: true } } } },
    },
  });

  const results = [];
  for (const student of students) {
    const weekRates: number[] = [];
    for (const w of weeks) {
      const recs = await this.prisma.attendanceRecord.findMany({
        where: { studentId: student.id, date: { gte: w.start, lte: w.end } },
        select: { status: true },
      });
      if (!recs.length) { weekRates.push(NaN); continue; }
      const present = recs.filter(r => ['PRESENT','LATE'].includes(r.status)).length;
      weekRates.push(present / recs.length);
    }

    const valid = weekRates.filter(r => !isNaN(r));
    if (valid.length < 2) continue;

    const avgRate = valid.reduce((a, b) => a + b, 0) / valid.length;
    if (avgRate >= 0.85) continue; // Solo en riesgo

    // Regresión lineal simple (slope)
    const n = valid.length;
    const xs = valid.map((_, i) => i);
    const meanX = xs.reduce((a,b)=>a+b,0)/n;
    const meanY = valid.reduce((a,b)=>a+b,0)/n;
    const slope = xs.reduce((s,x,i)=>s+(x-meanX)*(valid[i]-meanY),0) /
                  xs.reduce((s,x)=>s+(x-meanX)**2,0);

    results.push({
      id: student.id,
      name: `${student.firstName} ${student.lastName}`,
      rut: student.rut,
      course: student.enrollments[0]?.course.code ?? '—',
      avgRate: Math.round(avgRate * 1000) / 1000,
      slope: Math.round(slope * 1000) / 1000,
      risk: slope < -0.02 ? 'high' : slope < 0 ? 'medium' : 'stable',
      weekRates,
    });
  }

  return results.sort((a, b) => a.avgRate - b.avgRate).slice(0, 20);
}
```

En controller agregar:

```typescript
@Get('school/:schoolId/risk-prediction')
@Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
getRiskPrediction(@Param('schoolId') schoolId: string) {
  return this.insights.getRiskPrediction(schoolId);
}
```

- [ ] **Step 2: Crear componente RiskPredictor**

```tsx
// apps/web/src/features/dashboard/components/RiskPredictor.tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { TrendingDown, Minus, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';

type Student = {
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
    color: 'text-red-600 bg-red-50 dark:bg-red-900/20',
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
  const min = 0;
  const max = 1;
  const w = 60;
  const h = 24;
  const pts = valid
    .map((r, i) => {
      const x = (i / (valid.length - 1)) * w;
      const y = h - ((r - min) / (max - min)) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="flex-shrink-0">
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
  const { data = [], isLoading } = useQuery<Student[]>({
    queryKey: ['risk-prediction', schoolId],
    queryFn: () => api.get(`/insights/school/${schoolId}/risk-prediction`),
    enabled: !!schoolId,
    staleTime: 1000 * 60 * 10, // 10 min — es costoso calcular
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
                    className="font-medium hover:text-primary"
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
  );
}
```

- [ ] **Step 3: Integrar en DirectorDashboard después de at-risk table**

```tsx
import { RiskPredictor } from './components/RiskPredictor';
// ...dentro del return, después de atRisk table:
<RiskPredictor schoolId={schoolId} />;
```

- [ ] **Step 4: Typecheck + deploy**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
pnpm --filter @asistencia/web exec tsc --noEmit
pnpm --filter @asistencia/api build
pnpm --filter @asistencia/web build
```

---

## SPRINT C — Diferenciadores comerciales

> Duración estimada: 4-5 días. Lo que hace que un colegio pague.

### Archivos a modificar/crear (Sprint C)

| Archivo                                                  | Acción                               |
| -------------------------------------------------------- | ------------------------------------ |
| `apps/api/src/students/students.controller.ts`           | Agregar: GET /:id/qr                 |
| `apps/api/src/students/students.service.ts`              | Agregar: generateQr()                |
| `apps/web/src/features/courses/components/QrScanner.tsx` | Crear                                |
| `apps/web/src/features/courses/CourseDetailPage.tsx`     | Agregar: modo QR scanner             |
| `apps/api/src/reports/reports.service.ts`                | Agregar: PDF formal con logo MINEDUC |
| `apps/api/src/reports/reports.controller.ts`             | Agregar: endpoints PDF mejorados     |
| `apps/api/src/mail/mail.service.ts`                      | Agregar: WhatsApp via Twilio         |
| `apps/api/src/config/configuration.ts`                   | Agregar: twilio config               |
| `apps/web/src/features/dashboard/DirectorDashboard.tsx`  | Agregar: widget IA insights          |

---

### Task C1: QR Code por alumno + scanner para asistencia

**Files:**

- Modify: `apps/api/src/students/students.controller.ts`
- Modify: `apps/api/src/students/students.service.ts`
- Create: `apps/web/src/features/courses/components/QrScanner.tsx`
- Modify: `apps/web/src/features/courses/CourseDetailPage.tsx`

Flujo: cada alumno tiene QR con su ID → profesor abre "Modo QR" en la clase → escanea desde cámara → marca PRESENTE automáticamente.

- [ ] **Step 1: Instalar dependencias**

```bash
pnpm --filter @asistencia/api add qrcode
pnpm --filter @asistencia/api add -D @types/qrcode
pnpm --filter @asistencia/web add jsqr
```

- [ ] **Step 2: Endpoint `GET /students/:id/qr` — genera PNG base64**

En `students.service.ts`:

```typescript
import * as QRCode from 'qrcode';

async getQrCode(studentId: string): Promise<string> {
  // El QR contiene solo el ID del alumno (no datos sensibles)
  return QRCode.toDataURL(`cssp:student:${studentId}`, {
    width: 256,
    margin: 2,
    color: { dark: '#008269', light: '#FFFFFF' },
  });
}
```

En `students.controller.ts`:

```typescript
@Get(':id/qr')
@Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.PROFESOR)
@ApiOperation({ summary: 'Código QR del alumno para asistencia' })
async getQr(@Param('id') id: string, @Res() res: Response) {
  const dataUrl = await this.students.getQrCode(id);
  const base64 = dataUrl.replace('data:image/png;base64,', '');
  const buf = Buffer.from(base64, 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `inline; filename="qr-${id}.png"`);
  res.end(buf);
}
```

- [ ] **Step 3: Crear QrScanner component**

```tsx
// apps/web/src/features/courses/components/QrScanner.tsx
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { X } from 'lucide-react';

type Props = {
  onScan: (studentId: string) => void;
  onClose: () => void;
};

export function QrScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          scan();
        }
      })
      .catch(() => setError('No se pudo acceder a la cámara. Verifica los permisos.'));

    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function scan() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scan);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code?.data.startsWith('cssp:student:')) {
      const id = code.data.replace('cssp:student:', '');
      if (id !== lastScanned) {
        setLastScanned(id);
        onScan(id);
        // Feedback visual
        setTimeout(() => setLastScanned(null), 2000);
      }
    }
    rafRef.current = requestAnimationFrame(scan);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="font-semibold">Escanear QR del alumno</span>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white text-center px-8">{error}</p>
        </div>
      ) : (
        <div className="flex-1 relative">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          {/* Visor */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-64 h-64 border-2 border-primary rounded-2xl" />
          </div>
          {lastScanned && (
            <div className="absolute bottom-8 left-0 right-0 flex justify-center">
              <div className="bg-green-500 text-white px-6 py-3 rounded-full font-semibold animate-bounce">
                ✓ Alumno marcado presente
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Integrar modo QR en CourseDetailPage**

En `CourseDetailPage.tsx`, agregar:

1. Botón "Modo QR" en la toolbar junto a las acciones rápidas
2. Estado `showQr: boolean`
3. Cuando scan → buscar alumno por ID en el roster → cambiar estado a PRESENT

```tsx
import { QrScanner } from './components/QrScanner';
// Estado: const [showQr, setShowQr] = useState(false);
// Botón: <button onClick={() => setShowQr(true)}>📷 Modo QR</button>
// Handler:
function handleQrScan(studentId: string) {
  // Encontrar el alumno en el roster y marcarlo PRESENTE
  setAttendance((prev) => ({ ...prev, [studentId]: 'PRESENT' }));
  // Feedback: toast.success(`Alumno marcado presente`)
}
// Modal: {showQr && <QrScanner onScan={handleQrScan} onClose={() => setShowQr(false)} />}
```

- [ ] **Step 5: Imprimir QR desde StudentDetailPage**

En `StudentDetailPage.tsx`, agregar botón "Imprimir QR":

```tsx
<a
  href={`${API_BASE}/students/${studentId}/qr`}
  target="_blank"
  download
  className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted"
>
  📷 Descargar QR
</a>
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
pnpm --filter @asistencia/web exec tsc --noEmit
```

---

### Task C2: PDF formal MINEDUC con logo del colegio

**Files:**

- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/src/reports/reports.controller.ts`

El PDF debe tener: logo del colegio, encabezado MINEDUC-style, tabla de asistencia por alumno, firma y sello.

- [ ] **Step 1: Instalar PDFKit**

```bash
pnpm --filter @asistencia/api add pdfkit
pnpm --filter @asistencia/api add -D @types/pdfkit
```

- [ ] **Step 2: Crear generador PDF en reports.service.ts**

En `reports.service.ts`, agregar método:

```typescript
import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';

async generateMonthlyPdf(courseId: string, year: number, month: number): Promise<Buffer> {
  const course = await this.prisma.course.findUnique({
    where: { id: courseId },
    include: {
      school: { select: { name: true } },
      students: {
        where: { active: true },
        include: { student: { select: { firstName: true, lastName: true, rut: true } } },
        orderBy: [{ student: { lastName: 'asc' } }],
      },
    },
  });
  if (!course) throw new NotFoundException('Curso no encontrado');

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);
  const monthName = from.toLocaleString('es-CL', { month: 'long', year: 'numeric' });

  // Obtener todos los días hábiles del mes
  const records = await this.prisma.attendanceRecord.findMany({
    where: { courseId, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  });

  const days = [...new Set(records.map(r => r.date.toISOString().split('T')[0]))].sort();

  // Por alumno
  const byStudent = new Map<string, Map<string, string>>();
  for (const r of records) {
    const key = r.studentId;
    if (!byStudent.has(key)) byStudent.set(key, new Map());
    byStudent.get(key)!.set(r.date.toISOString().split('T')[0], r.status);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const buffers: Buffer[] = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Header
    doc.fontSize(10).fillColor('#008269')
       .text(course.school.name, 40, 40, { align: 'center' });
    doc.fontSize(9).fillColor('#444')
       .text('REGISTRO MENSUAL DE ASISTENCIA', 40, 55, { align: 'center' });
    doc.fontSize(8).fillColor('#666')
       .text(`Curso: ${course.name} (${course.code}) · Período: ${monthName}`, 40, 70, { align: 'center' });

    doc.moveTo(40, 82).lineTo(800, 82).strokeColor('#008269').lineWidth(1).stroke();

    // Tabla: columna alumno + una columna por día
    const startY = 95;
    const rowH = 14;
    const nameColW = 160;
    const dayColW = Math.min(20, (760 - nameColW) / Math.max(days.length, 1));
    let y = startY;

    // Header fila
    doc.fontSize(7).fillColor('#333').text('Alumno / RUT', 40, y);
    days.forEach((d, i) => {
      const dayNum = new Date(d + 'T12:00').getDate().toString().padStart(2, '0');
      doc.text(dayNum, 40 + nameColW + i * dayColW, y, { width: dayColW, align: 'center' });
    });
    doc.text('% Asist.', 40 + nameColW + days.length * dayColW, y, { width: 50, align: 'right' });
    y += rowH + 2;
    doc.moveTo(40, y - 2).lineTo(800, y - 2).strokeColor('#ccc').stroke();

    // Filas de alumnos
    for (const enrollment of course.students) {
      const s = enrollment.student;
      const name = `${s.lastName}, ${s.firstName}`;
      doc.fontSize(6.5).fillColor('#111').text(`${name}`, 40, y, { width: nameColW - 5 });
      doc.fillColor('#888').text(s.rut, 40, y + 7, { width: nameColW - 5 });

      const studentRecs = byStudent.get(enrollment.studentId) ?? new Map();
      let presents = 0;
      days.forEach((d, i) => {
        const status = studentRecs.get(d) ?? '';
        const symbol = status === 'PRESENT' ? 'P' : status === 'ABSENT' ? 'A' : status === 'LATE' ? 'AT' : status === 'JUSTIFIED' ? 'J' : '';
        const color = status === 'PRESENT' ? '#22c55e' : status === 'ABSENT' ? '#ef4444' : status === 'LATE' ? '#f59e0b' : '#3b82f6';
        doc.fontSize(6).fillColor(color)
           .text(symbol, 40 + nameColW + i * dayColW, y + 3, { width: dayColW, align: 'center' });
        if (['PRESENT', 'LATE'].includes(status)) presents++;
      });

      const rate = days.length > 0 ? (presents / days.length * 100).toFixed(1) + '%' : '—';
      doc.fontSize(7).fillColor(presents / days.length < 0.85 ? '#ef4444' : '#22c55e')
         .text(rate, 40 + nameColW + days.length * dayColW, y + 3, { width: 50, align: 'right' });

      y += rowH * 2;
      if (y > 540) { doc.addPage({ layout: 'landscape' }); y = 40; }
    }

    // Footer
    doc.fontSize(7).fillColor('#999')
       .text(`Generado el ${new Date().toLocaleDateString('es-CL')} · Sistema de Asistencia CSSP`, 40, 560, { align: 'center' });

    doc.end();
  });
}
```

- [ ] **Step 3: Agregar endpoint**

En `reports.controller.ts`:

```typescript
@Get('course/:id/monthly-pdf')
@Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.PROFESOR)
async monthlyPdf(
  @Param('id') id: string,
  @Query('year') year: string,
  @Query('month') month: string,
  @Res() res: Response,
) {
  const buf = await this.reports.generateMonthlyPdf(id, +year, +month);
  const monthName = new Date(+year, +month - 1, 1).toLocaleString('es-CL', { month: 'long' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="asistencia-${monthName}-${year}.pdf"`);
  res.end(buf);
}
```

- [ ] **Step 4: Agregar botón en ReportesPage**

En `apps/web/src/routes/_auth.reportes.tsx`, en la sección de reportes mensuales:

```tsx
<a
  href={`${API_BASE}/reports/course/${selectedCourse}/monthly-pdf?year=${year}&month=${month}`}
  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted"
>
  📄 PDF formal MINEDUC
</a>
```

---

### Task C3: Notificaciones WhatsApp via Twilio

**Files:**

- Modify: `apps/api/src/config/configuration.ts`
- Create: `apps/api/src/mail/whatsapp.service.ts`
- Modify: `apps/api/src/attendance/attendance.service.ts`
- Modify: `apps/api/src/users/users.module.ts`

- [ ] **Step 1: Instalar Twilio**

```bash
pnpm --filter @asistencia/api add twilio
pnpm --filter @asistencia/api add -D @types/twilio
```

- [ ] **Step 2: Agregar config Twilio**

En `configuration.ts` agregar en la sección de config:

```typescript
twilio: {
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886', // Sandbox default
  enabled: process.env.TWILIO_ENABLED === 'true',
},
```

- [ ] **Step 3: Crear WhatsAppService**

```typescript
// apps/api/src/mail/whatsapp.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import type { AppConfig } from '../config/configuration.js';

@Injectable()
export class WhatsAppService {
  private readonly log = new Logger(WhatsAppService.name);
  private client: ReturnType<typeof Twilio> | null = null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const sid = config.get('twilio.accountSid', { infer: true });
    const token = config.get('twilio.authToken', { infer: true });
    if (sid && token && config.get('twilio.enabled', { infer: true })) {
      this.client = Twilio(sid, token);
    }
  }

  async sendAbsenceAlert(params: {
    guardianPhone: string; // formato: +56912345678
    studentName: string;
    courseName: string;
    date: Date;
    schoolName: string;
  }): Promise<void> {
    if (!this.client) {
      this.log.debug('WhatsApp disabled — skip send');
      return;
    }
    const from = this.config.get('twilio.whatsappFrom', { infer: true });
    const dateStr = params.date.toLocaleDateString('es-CL');
    const body = `🏫 *${params.schoolName}*\n\nEstimado apoderado, le informamos que *${params.studentName}* no asistió al curso *${params.courseName}* el día *${dateStr}*.\n\nPuede justificar la inasistencia en el portal de apoderados.`;
    try {
      await this.client.messages.create({
        from,
        to: `whatsapp:${params.guardianPhone}`,
        body,
      });
      this.log.log(`WhatsApp sent to ${params.guardianPhone}`);
    } catch (e) {
      this.log.warn(`WhatsApp failed to ${params.guardianPhone}: ${(e as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Agregar campo phone al modelo Guardian**

Verificar en `schema.prisma` si `Guardian` o `User` tiene campo `phone`. Si no:

```prisma
// En modelo User o Guardianship:
phone String? @db.VarChar(20)
```

Crear migración:

```bash
pnpm --filter @asistencia/api exec prisma migrate dev --name add_user_phone
```

- [ ] **Step 5: Registrar WhatsAppService en MailModule**

En `apps/api/src/mail/mail.module.ts`:

```typescript
import { WhatsAppService } from './whatsapp.service.js';
// providers: [MailService, WhatsAppService]
// exports: [MailService, WhatsAppService]
```

- [ ] **Step 6: Trigger WhatsApp en attendance.service (junto al email)**

En `attendance.service.ts`, donde se llama `notifyGuardiansAbsence`:

```typescript
// Después del mail, enviar WhatsApp si el apoderado tiene teléfono
if (guardian.phone) {
  void this.whatsapp.sendAbsenceAlert({
    guardianPhone: guardian.phone,
    studentName: `${student.firstName} ${student.lastName}`,
    courseName: course.name,
    date: record.date,
    schoolName: school.name,
  });
}
```

- [ ] **Step 7: Agregar campo phone en Users form**

En `apps/web/src/routes/_auth.usuarios.tsx`, en `UserModal`, agregar campo teléfono:

```tsx
<div className="flex flex-col gap-1">
  <label className="text-xs text-muted-foreground font-medium">Teléfono (WhatsApp, opcional)</label>
  <input
    type="tel"
    placeholder="+56912345678"
    value={phone}
    onChange={(e) => setPhone(e.target.value)}
    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
  />
</div>
```

---

## SPRINT D — Arquitectura enterprise

> Duración estimada: 5-7 días. Para cuando haya más de un colegio cliente.

### Task D1: Multi-tenant UI (selector de colegio para SUPER_ADMIN)

El SUPER_ADMIN actualmente no tiene schoolId → pages vacías. Necesita selector global.

**Files:**

- Modify: `apps/web/src/routes/_auth.tsx`
- Create: `apps/web/src/stores/school.store.ts`

- [ ] **Step 1: Crear school.store.ts**

```typescript
// apps/web/src/stores/school.store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type School = { id: string; name: string };
type Store = {
  selectedSchool: School | null;
  setSelectedSchool: (s: School | null) => void;
};

export const useSchoolStore = create<Store>()(
  persist(
    (set) => ({
      selectedSchool: null,
      setSelectedSchool: (s) => set({ selectedSchool: s }),
    }),
    { name: 'cssp-school' },
  ),
);

export const useEffectiveSchoolId = () => {
  // Importar desde auth.store y school.store
  // Si user tiene schoolId → usar ese
  // Si SUPER_ADMIN → usar selectedSchool
  // Este hook se usa en TODOS los componentes en vez de user?.schoolId
};
```

- [ ] **Step 2: SchoolSelector en topbar (\_auth.tsx)**

En `_auth.tsx` (AppLayout), si `user.roles.includes('SUPER_ADMIN')` y `!user.schoolId`:

```tsx
// Agregar SchoolSelector en topbar
function SchoolSelector() {
  const { data: schools } = useQuery({ queryKey: ['schools'], queryFn: () => api.get('/schools') });
  const { selectedSchool, setSelectedSchool } = useSchoolStore();
  return (
    <select
      value={selectedSchool?.id ?? ''}
      onChange={(e) => {
        const school = schools?.find((s) => s.id === e.target.value);
        setSelectedSchool(school ?? null);
      }}
      className="text-sm rounded-lg border border-border bg-background px-3 py-1.5"
    >
      <option value="">Seleccionar colegio…</option>
      {schools?.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
```

---

### Task D2: PWA Offline — Service Worker para marcar asistencia sin internet

**Files:**

- Create: `apps/web/public/sw.js`
- Modify: `apps/web/index.html`
- Create: `apps/web/src/lib/offline-queue.ts`

- [ ] **Step 1: Crear offline-queue.ts**

```typescript
// apps/web/src/lib/offline-queue.ts
const DB_NAME = 'cssp-offline';
const STORE = 'attendance-queue';

type QueueEntry = {
  id: string;
  courseId: string;
  date: string;
  records: Record<string, string>;
  timestamp: number;
};

export async function queueAttendance(entry: Omit<QueueEntry, 'timestamp'>) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.objectStore(STORE).put({ ...entry, timestamp: Date.now() });
}

export async function getQueue(): Promise<QueueEntry[]> {
  const db = await openDb();
  return db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
}

export async function clearEntry(id: string) {
  const db = await openDb();
  db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

- [ ] **Step 2: Hook useOnlineSync en CourseDetailPage**

```typescript
// En CourseDetailPage, al volver a estar online:
useEffect(() => {
  const handler = async () => {
    if (navigator.onLine) {
      const queue = await getQueue();
      for (const entry of queue) {
        try {
          await api.post(`/attendance/course/${entry.courseId}/bulk`, {
            date: entry.date,
            records: entry.records,
          });
          await clearEntry(entry.id);
          toast.success('Asistencia sincronizada');
        } catch {
          /* retry next time */
        }
      }
    }
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}, []);
```

---

## Verificación end-to-end

```bash
# TypeScript limpio
pnpm --filter @asistencia/api exec tsc --noEmit
pnpm --filter @asistencia/web exec tsc --noEmit

# Build exitoso
pnpm --filter @asistencia/api build
pnpm --filter @asistencia/web build

# Tests
pnpm test

# En prod
curl https://asistencia.nicoholas.dev/api/v1/health
# → {"status":"ok"}
```

**Checkpoints de aceptación:**

1. Sprint A: Theme toggle hace animación círculo · Justificaciones tiene tabs + review inline · Mobile touch targets ≥ 44px
2. Sprint B: DirectorDashboard muestra heatmap + tabla predicción riesgo · Sparklines por alumno
3. Sprint C: Escanear QR marca alumno presente instantáneamente · PDF descargable con logo CSSP · WhatsApp llega a guardian en < 30s tras marcar ausencia
4. Sprint D: SUPER_ADMIN elige colegio en topbar · Attendance se guarda offline y sincroniza al reconectar

---

## Prioridad recomendada

| Sprint             | Impacto comercial              | Dificultad | Empezar   |
| ------------------ | ------------------------------ | ---------- | --------- |
| A — UX polish      | Alto (percepción)              | Bajo       | Inmediato |
| B — Analytics BI   | Muy alto (vende a directivos)  | Medio      | Tras A    |
| C1 — QR attendance | Alto (eficiencia docente)      | Medio      | Junto B   |
| C2 — PDF MINEDUC   | Alto (cumplimiento legal)      | Bajo       | Junto B   |
| C3 — WhatsApp      | Muy alto (percepción familias) | Alto       | Tras C1   |
| D1 — Multi-tenant  | Alto (escalabilidad)           | Medio      | Tras C    |
| D2 — PWA Offline   | Alto (fiabilidad)              | Alto       | Último    |
