import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Bell, Play, Trash2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { TRIGGER_DEFAULT_THRESHOLD, thresholdPayload } from '@/lib/alert-threshold';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';

export const Route = createFileRoute('/_auth/alertas')({
  component: AlertasPage,
});

type AlertTrigger =
  | 'STUDENT_BELOW_THRESHOLD'
  | 'COURSE_BELOW_THRESHOLD'
  | 'STUDENT_CONSECUTIVE_ABSENCES'
  | 'TEACHER_NO_RECORD';

type AlertRule = {
  id: string;
  trigger: AlertTrigger;
  threshold: number | null;
  windowDays: number;
  enabled: boolean;
  notifyRoles: string;
  createdAt: string;
};
type FiredAlert = {
  id: string;
  firedAt: string;
  rule: { trigger: AlertTrigger; threshold: number | null };
};

const TRIGGER_LABELS: Record<AlertTrigger, string> = {
  STUDENT_BELOW_THRESHOLD: 'Alumno bajo umbral de asistencia',
  COURSE_BELOW_THRESHOLD: 'Curso bajo umbral de asistencia',
  STUDENT_CONSECUTIVE_ABSENCES: 'Ausencias consecutivas',
  TEACHER_NO_RECORD: 'Profesor sin registro',
};

const TRIGGER_DESCRIPTIONS: Record<AlertTrigger, string> = {
  STUDENT_BELOW_THRESHOLD: 'Notifica cuando un alumno cae bajo el % de asistencia configurado',
  COURSE_BELOW_THRESHOLD: 'Notifica cuando un curso entero cae bajo el umbral',
  STUDENT_CONSECUTIVE_ABSENCES: 'Notifica cuando un alumno acumula N días seguidos de ausencia',
  TEACHER_NO_RECORD:
    'Notifica cuando un profesor no ha registrado asistencia en N días lectivos (no cuenta feriados ni vacaciones)',
};

const ALL_TRIGGERS: AlertTrigger[] = [
  'STUDENT_BELOW_THRESHOLD',
  'COURSE_BELOW_THRESHOLD',
  'STUDENT_CONSECUTIVE_ABSENCES',
  'TEACHER_NO_RECORD',
];

function parseRoles(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

type FormState = {
  trigger: AlertTrigger;
  threshold: string;
  windowDays: string;
  enabled: boolean;
};

const DEFAULTS: FormState = {
  trigger: 'STUDENT_BELOW_THRESHOLD',
  threshold: '85',
  windowDays: '30',
  enabled: true,
};

function AlertasPage() {
  const user = useUser();
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();
  const canEdit = user?.roles?.some((r) => ['SUPER_ADMIN', 'DIRECTOR'].includes(r)) ?? false;

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [showForm, setShowForm] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ checked: number; fired: number } | null>(
    null,
  );

  const { data: rules = [], isLoading } = useQuery<AlertRule[]>({
    queryKey: ['alertRules', schoolId],
    queryFn: () => api.get(`/alerts/school/${schoolId}/rules`),
    enabled: !!schoolId,
  });
  const { data: recentFired = [] } = useQuery<FiredAlert[]>({
    queryKey: ['recent-fired-alerts-page', schoolId],
    queryFn: () => api.get('/alerts/fired/recent'),
    enabled: !!schoolId,
  });

  const upsert = useMutation({
    mutationFn: (body: object) => api.put(`/alerts/school/${schoolId}/rules`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertRules', schoolId] });
      setShowForm(false);
      setForm(DEFAULTS);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/alerts/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertRules', schoolId] }),
  });

  const trigger = useMutation({
    mutationFn: () => api.post(`/alerts/school/${schoolId}/trigger`, {}),
    onSuccess: (data: unknown) => setTriggerResult(data as { checked: number; fired: number }),
  });

  const existingTriggers = new Set(rules.map((r) => r.trigger));
  const enabledCount = rules.filter((rule) => rule.enabled).length;
  const lastRunLabel = recentFired[0]
    ? new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(recentFired[0].firedAt))
    : 'Sin disparos';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    upsert.mutate({
      trigger: form.trigger,
      threshold: thresholdPayload(form.trigger, form.threshold),
      windowDays: parseInt(form.windowDays, 10) || 30,
      enabled: form.enabled,
      notifyRoles: ['DIRECTOR', 'UTP', 'INSPECTORIA'],
    });
  }

  const availableTriggers = ALL_TRIGGERS.filter((t) => !existingTriggers.has(t));

  return (
    <div className="space-y-6 overflow-hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alertas automáticas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reglas preventivas para detectar inasistencia, cursos bajo umbral y registros
            pendientes.
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {canEdit && (
            <button
              onClick={() => trigger.mutate()}
              disabled={trigger.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-muted transition-colors"
            >
              <Play className="h-4 w-4" />
              {trigger.isPending ? 'Ejecutando…' : 'Ejecutar ahora'}
            </button>
          )}
          {canEdit && availableTriggers.length > 0 && (
            <button
              onClick={() => {
                setShowForm(true);
                if (availableTriggers[0])
                  setForm({
                    ...DEFAULTS,
                    trigger: availableTriggers[0],
                    threshold: TRIGGER_DEFAULT_THRESHOLD[availableTriggers[0]],
                  });
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Nueva regla
            </button>
          )}
        </div>
      </div>

      {triggerResult && (
        <div className="rounded-lg border border-border bg-muted/40 px-5 py-3 text-sm">
          Ejecución completada — {triggerResult.checked} regla
          {triggerResult.checked !== 1 ? 's' : ''} evaluada{triggerResult.checked !== 1 ? 's' : ''},{' '}
          {triggerResult.fired} alerta{triggerResult.fired !== 1 ? 's' : ''} disparada
          {triggerResult.fired !== 1 ? 's' : ''}.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-xs text-muted-foreground">Reglas activas</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {enabledCount}/{rules.length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-xs text-muted-foreground">Últimas alertas</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{recentFired.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-xs text-muted-foreground">Último disparo</p>
          <p className="mt-1 text-lg font-semibold">{lastRunLabel}</p>
        </div>
      </div>

      {recentFired.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5 space-y-3">
          <h2 className="text-sm font-semibold">Alertas recientes</h2>
          <div className="divide-y divide-border">
            {recentFired.slice(0, 5).map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">{TRIGGER_LABELS[alert.rule.trigger]}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat('es-CL', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(alert.firedAt))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && canEdit && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border bg-background p-5 space-y-4"
        >
          <h2 className="font-semibold text-base">Nueva regla de alerta</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="alert-trigger" className="text-xs text-muted-foreground font-medium">
                Tipo de alerta
              </label>
              <select
                id="alert-trigger"
                value={form.trigger}
                onChange={(e) => {
                  const trigger = e.target.value as AlertTrigger;
                  setForm((f) => ({
                    ...f,
                    trigger,
                    threshold: TRIGGER_DEFAULT_THRESHOLD[trigger],
                  }));
                }}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {availableTriggers.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{TRIGGER_DESCRIPTIONS[form.trigger]}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="alert-threshold"
                className="text-xs text-muted-foreground font-medium"
              >
                {form.trigger === 'TEACHER_NO_RECORD'
                  ? 'Días lectivos sin registro'
                  : form.trigger === 'STUDENT_CONSECUTIVE_ABSENCES'
                    ? 'Ausencias consecutivas mínimas'
                    : 'Umbral de asistencia (%)'}
              </label>
              <input
                id="alert-threshold"
                type="number"
                value={form.threshold}
                onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                min={1}
                max={form.trigger.endsWith('THRESHOLD') ? 100 : 365}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="alert-window" className="text-xs text-muted-foreground font-medium">
                Ventana de análisis (días)
              </label>
              <input
                id="alert-window"
                type="number"
                value={form.windowDays}
                onChange={(e) => setForm((f) => ({ ...f, windowDays: e.target.value }))}
                min={1}
                max={365}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <input
                type="checkbox"
                id="enabled"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="enabled" className="text-sm">
                Activa
              </label>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={upsert.isPending}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {upsert.isPending ? 'Guardando…' : 'Guardar regla'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Cargando reglas…</div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-background p-10 text-center">
          <Bell className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Sin reglas de alerta configuradas</p>
          <p className="text-xs text-muted-foreground mt-1">
            Las reglas activas se evalúan automáticamente cada día hábil a las 07:00
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-xl border border-border bg-background p-5 flex items-start gap-4"
            >
              <div
                className={`mt-0.5 h-3 w-3 rounded-full flex-shrink-0 ${rule.enabled ? 'bg-success' : 'bg-muted-foreground'}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{TRIGGER_LABELS[rule.trigger]}</span>
                  {!rule.enabled && (
                    <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      Desactivada
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {TRIGGER_DESCRIPTIONS[rule.trigger]}
                </p>
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                  {rule.threshold != null && (
                    <span>
                      Umbral:{' '}
                      <strong className="text-foreground">
                        {rule.trigger.endsWith('THRESHOLD')
                          ? `${(rule.threshold * 100).toFixed(0)}%`
                          : rule.threshold}
                      </strong>
                    </span>
                  )}
                  <span>
                    Ventana: <strong className="text-foreground">{rule.windowDays} días</strong>
                  </span>
                  <span>
                    Notifica a:{' '}
                    <strong className="text-foreground">
                      {parseRoles(rule.notifyRoles).join(', ')}
                    </strong>
                  </span>
                </div>
              </div>
              {canEdit && (
                <button
                  onClick={() => {
                    const ok = window.confirm(
                      `Eliminar regla "${TRIGGER_LABELS[rule.trigger]}"? Esta acción detiene sus notificaciones.`,
                    );
                    if (ok) remove.mutate(rule.id);
                  }}
                  disabled={remove.isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  title="Eliminar regla"
                  aria-label={`Eliminar regla ${TRIGGER_LABELS[rule.trigger]}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
