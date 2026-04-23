import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Ban, CheckCircle2, Clock, Info, Mail, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';

type Quota = {
  sentToday: number;
  limit: number;
  remaining: number;
  pending: number;
  providerCredits: number | null;
};
type OutboxRow = {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  category: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
};

type Audience = 'ALL_GUARDIANS' | 'ALL_STAFF' | 'ALL';
type FilterStatus = 'ALL' | 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

const STATUS_ICON: Record<OutboxRow['status'], { icon: typeof Mail; cls: string }> = {
  PENDING: { icon: Clock, cls: 'text-amber-600' },
  SENDING: { icon: Send, cls: 'text-blue-600' },
  SENT: { icon: CheckCircle2, cls: 'text-green-600' },
  FAILED: { icon: XCircle, cls: 'text-red-600' },
  CANCELLED: { icon: Ban, cls: 'text-gray-500' },
};

const CATEGORY_LABEL: Record<string, string> = {
  ABSENCE_DAILY: 'Inasistencia',
  JUSTIFICATION_RESULT: 'Justificación',
  WEEKLY_DIGEST: 'Resumen semanal',
  CLASS_SUSPENSION: 'Calendario',
  BROADCAST: 'Broadcast',
  SYSTEM: 'Sistema',
};

export function MailPage() {
  const user = useUser();
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [broadcast, setBroadcast] = useState({
    title: '',
    body: '',
    audience: 'ALL_GUARDIANS' as Audience,
    shareable: true,
  });
  const [testEmail, setTestEmail] = useState(user?.email ?? '');

  const { data: quota, isLoading: loadingQuota } = useQuery<Quota>({
    queryKey: ['mail', 'quota'],
    queryFn: () => api.get('/mail/quota'),
    refetchInterval: 30_000,
  });

  const { data: outbox, isLoading: loadingOutbox } = useQuery<OutboxRow[]>({
    queryKey: ['mail', 'outbox', filter],
    queryFn: () => api.get(`/mail/outbox${filter !== 'ALL' ? `?status=${filter}` : ''}`),
    refetchInterval: 30_000,
  });

  const testMut = useMutation({
    mutationFn: (to: string) => api.post('/mail/test', { to }),
    onSuccess: () => {
      toast.success('Correo de prueba encolado · se enviará en <5 min');
      void qc.invalidateQueries({ queryKey: ['mail'] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const broadcastMut = useMutation({
    mutationFn: () =>
      api.post<{ enqueued: number; deduped: number; totalRecipients: number }>('/mail/broadcast', {
        schoolId,
        ...broadcast,
      }),
    onSuccess: (r) => {
      toast.success(
        `${r.enqueued}/${r.totalRecipients} correos en cola · distribuidos según cuota diaria`,
      );
      setBroadcast({ title: '', body: '', audience: 'ALL_GUARDIANS', shareable: true });
      void qc.invalidateQueries({ queryKey: ['mail'] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const cancelMut = useMutation({
    mutationFn: (ids: string[]) => api.post<{ cancelled: number }>('/mail/cancel', { ids }),
    onSuccess: (r) => {
      toast.success(`${r.cancelled} cancelado(s)`);
      void qc.invalidateQueries({ queryKey: ['mail'] });
    },
  });

  const quotaPct = quota ? Math.min(100, (quota.sentToday / quota.limit) * 100) : 0;
  const quotaColor = quotaPct < 60 ? '#16a34a' : quotaPct < 85 ? '#f59e0b' : '#dc2626';

  const broadcastRisk =
    quota && broadcast.audience ? audienceSizeHint(broadcast.audience) > quota.remaining : false;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Correo</h1>
        <p className="text-sm text-muted-foreground">
          Brevo HTTPS · cuota gratuita 300/día · los correos en exceso se envían el día siguiente
          automáticamente
        </p>
      </div>

      {/* Quota card */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Cuota del día</h2>
          {loadingQuota && <span className="text-xs text-muted-foreground">actualizando…</span>}
        </div>
        {quota && (
          <>
            <div className="flex items-baseline gap-3">
              <div className="text-3xl font-bold tabular-nums" style={{ color: quotaColor }}>
                {quota.sentToday}
              </div>
              <div className="text-sm text-muted-foreground">/ {quota.limit} enviados hoy</div>
              <div className="ml-auto text-xs text-muted-foreground">
                Pendientes: <strong>{quota.pending}</strong>
                {quota.providerCredits != null && (
                  <>
                    {' '}
                    · Créditos Brevo: <strong>{quota.providerCredits}</strong>
                  </>
                )}
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full transition-all"
                style={{ width: `${quotaPct}%`, background: quotaColor }}
              />
            </div>
            {quota.remaining === 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded p-2 flex items-center gap-2">
                <AlertCircle className="size-4" />
                Cuota diaria agotada. Los correos pendientes se enviarán automáticamente mañana.
              </div>
            )}
          </>
        )}
      </div>

      {/* Broadcast */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Envío masivo</h2>
          <p className="text-xs text-muted-foreground">
            Para avisos: cambios de horario, reuniones, comunicados generales
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="size-3.5 mt-0.5 text-primary flex-shrink-0" />
          <span>
            Las audiencias se construyen automáticamente desde los roles del sistema:{' '}
            <strong className="text-foreground">Apoderados</strong> → usuarios con rol APODERADO ·{' '}
            <strong className="text-foreground">Staff</strong> → DIRECTOR + UTP + PROFESOR · Para
            agregar destinatarios, crea usuarios en la sección{' '}
            <strong className="text-foreground">Usuarios</strong> con el rol correspondiente.
          </span>
        </div>
        <input
          type="text"
          placeholder="Asunto"
          value={broadcast.title}
          onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })}
          maxLength={200}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
        />
        <textarea
          placeholder="Mensaje (doble salto de línea = nuevo párrafo)"
          value={broadcast.body}
          onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })}
          maxLength={10000}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background min-h-32"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={broadcast.audience}
            onChange={(e) => setBroadcast({ ...broadcast, audience: e.target.value as Audience })}
            className="rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
          >
            <option value="ALL_GUARDIANS">Todos los apoderados</option>
            <option value="ALL_STAFF">Solo staff (directivos + profesores)</option>
            <option value="ALL">Toda la comunidad</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={broadcast.shareable}
              onChange={(e) => setBroadcast({ ...broadcast, shareable: e.target.checked })}
              className="rounded"
            />
            Pedir reenviar a otros apoderados (amplía alcance si llegamos al límite diario)
          </label>
          <button
            onClick={() => broadcastMut.mutate()}
            disabled={!broadcast.title || !broadcast.body || broadcastMut.isPending}
            className="text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {broadcastMut.isPending ? 'Encolando…' : 'Enviar'}
          </button>
          {broadcastRisk && (
            <span className="text-xs text-amber-700">
              Puede exceder la cuota diaria · el resto se enviará mañana
            </span>
          )}
        </div>
      </div>

      {/* Test send */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Envío de prueba</h2>
          <p className="text-xs text-muted-foreground">
            Valida la configuración Brevo enviando un correo
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm bg-background"
          />
          <button
            onClick={() => testMut.mutate(testEmail)}
            disabled={!testEmail || testMut.isPending}
            className="text-sm px-4 py-1.5 rounded-lg border hover:bg-muted disabled:opacity-50"
          >
            Enviar prueba
          </button>
        </div>
      </div>

      {/* Outbox */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold">Cola de correo (últimos 100)</h2>
          <div className="flex gap-1 text-xs">
            {(['ALL', 'PENDING', 'SENT', 'FAILED', 'CANCELLED'] as FilterStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-2 py-1 rounded ${filter === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {s === 'ALL' ? 'Todos' : s.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        {loadingOutbox ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse bg-muted rounded" />
            ))}
          </div>
        ) : !outbox?.length ? (
          <p className="p-6 text-sm text-muted-foreground text-center">Sin correos en esta vista</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 w-8" />
                  <th className="text-left px-4 py-2.5">Destinatario / Asunto</th>
                  <th className="text-left px-4 py-2.5 w-32">Tipo</th>
                  <th className="text-left px-4 py-2.5 w-28">Fecha</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {outbox.map((m) => {
                  const S = STATUS_ICON[m.status];
                  const dt = new Date(m.sentAt ?? m.createdAt);
                  return (
                    <tr
                      key={m.id}
                      className="border-t border-border hover:bg-muted/20 transition align-top"
                    >
                      <td className="px-3 py-2" title={m.status}>
                        <S.icon className={`size-4 ${S.cls}`} />
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{m.toName ?? m.toEmail}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-md">
                          {m.subject}
                        </div>
                        {m.lastError && (
                          <div
                            className="text-xs text-red-600 mt-0.5 truncate max-w-md"
                            title={m.lastError}
                          >
                            ⚠ {m.lastError}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                          {CATEGORY_LABEL[m.category] ?? m.category}
                        </span>
                        {m.priority === 'HIGH' && (
                          <span className="ml-1 text-[10px] font-bold text-red-600">●</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                        {dt.toLocaleString('es-CL', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {m.attempts > 1 && <div>intentos: {m.attempts}</div>}
                      </td>
                      <td className="px-2 py-2">
                        {m.status === 'PENDING' && (
                          <button
                            onClick={() => cancelMut.mutate([m.id])}
                            className="text-muted-foreground hover:text-destructive text-xs"
                            title="Cancelar"
                          >
                            <Ban className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function audienceSizeHint(a: Audience): number {
  // Heurística conservadora para advertir si excede la cuota
  if (a === 'ALL_STAFF') return 20;
  if (a === 'ALL_GUARDIANS') return 600;
  return 650;
}
