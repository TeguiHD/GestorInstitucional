import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '@/lib/api';

export const Route = createFileRoute('/_auth/auditoria')({
  component: AuditPage,
});

type AuditEvent = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  user: { email: string; firstName: string; lastName: string } | null;
  meta: unknown;
};

const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'text-green-600',
  LOGIN_FAILED: 'text-red-600',
  LOGOUT: 'text-muted-foreground',
  CREATE: 'text-blue-600',
  UPDATE: 'text-amber-600',
  DELETE: 'text-red-600',
  PASSWORD_CHANGE: 'text-purple-600',
};

function AuditPage() {
  const [offset, setOffset] = useState(0);
  const [filterAction, setFilterAction] = useState('');
  const limit = 50;

  const { data, isLoading } = useQuery<{ total: number; events: AuditEvent[] }>({
    queryKey: ['audit', offset, filterAction],
    queryFn: () =>
      api.get(
        `/audit?limit=${limit}&offset=${offset}${filterAction ? `&action=${filterAction}` : ''}`,
      ),
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auditoría</h1>
        <p className="text-sm text-muted-foreground">
          Registro inmutable de acciones del sistema con cadena de hash SHA-256
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold">
            {data ? `${data.total} eventos` : 'Cargando…'}
          </span>
          <select
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value);
              setOffset(0);
            }}
            className="text-xs rounded-lg border border-border px-3 py-1.5 bg-background"
          >
            <option value="">Todas las acciones</option>
            {[
              'LOGIN',
              'LOGIN_FAILED',
              'LOGOUT',
              'CREATE',
              'UPDATE',
              'DELETE',
              'PASSWORD_CHANGE',
              'TOTP_SETUP',
              'TOTP_DISABLED',
            ].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse bg-muted rounded" />
            ))}
          </div>
        ) : !data?.events.length ? (
          <p className="p-8 text-sm text-muted-foreground text-center">Sin eventos</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Fecha</th>
                  <th className="text-left px-4 py-2.5">Acción</th>
                  <th className="text-left px-4 py-2.5">Usuario</th>
                  <th className="text-left px-4 py-2.5">Entidad</th>
                  <th className="text-left px-4 py-2.5">IP</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id} className="border-t border-border hover:bg-muted/20 transition">
                    <td className="px-4 py-2 tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString('es-CL', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs font-mono font-semibold ${ACTION_COLORS[e.action] ?? 'text-foreground'}`}
                      >
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {e.user ? (
                        <div>
                          <div className="text-xs font-medium">
                            {e.user.firstName} {e.user.lastName}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{e.user.email}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {e.entity
                        ? `${e.entity}${e.entityId ? ` #${e.entityId.slice(0, 8)}` : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                      {e.ip ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Página {currentPage} de {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted"
              >
                ← Anterior
              </button>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + limit)}
                className="px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
