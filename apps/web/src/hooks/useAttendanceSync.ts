import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { attendanceQueue } from '@/lib/attendance-queue';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * Rechazo definitivo del servidor: reintentar jamás va a funcionar (p.ej. día
 * no lectivo, validación, sin permisos). 401 y 429 NO cuentan: la sesión se
 * puede renovar y el rate-limit pasa — esos se quedan en cola.
 */
function isPermanentRejection(e: unknown): e is ApiError {
  return (
    e instanceof ApiError &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 401 &&
    e.status !== 429
  );
}

export function useAttendanceSync() {
  const online = useOnlineStatus();
  const qc = useQueryClient();
  const syncingRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(() => attendanceQueue.count());

  // Refresh count whenever it might change
  const refreshCount = () => setPendingCount(attendanceQueue.count());

  useEffect(() => {
    if (!online || syncingRef.current) return;
    const pending = attendanceQueue.getAll();
    if (pending.length === 0) return;

    syncingRef.current = true;
    const toastId = toast.loading(
      `Sincronizando ${pending.length} registro${pending.length !== 1 ? 's' : ''} pendiente${pending.length !== 1 ? 's' : ''}…`,
    );

    void (async () => {
      let synced = 0;
      const rejected: string[] = [];
      for (const item of pending) {
        try {
          await api.post('/attendance', {
            courseId: item.courseId,
            date: item.date,
            entries: item.entries,
          });
          attendanceQueue.remove(item.id);
          synced++;
          void qc.invalidateQueries({ queryKey: ['attendance', item.courseId, item.date] });
        } catch (e) {
          if (isPermanentRejection(e)) {
            // Sacarlo de la cola: si no, reintenta para siempre y el contador
            // "pendiente" nunca baja. Se avisa al usuario qué día fue rechazado.
            attendanceQueue.remove(item.id);
            rejected.push(`${item.date}: ${e.message}`);
          }
          // Errores de red / 5xx / 401 / 429: se mantiene en cola y se reintenta.
        }
      }
      toast.dismiss(toastId);
      if (synced > 0) {
        toast.success(
          `${synced} registro${synced !== 1 ? 's' : ''} sincronizado${synced !== 1 ? 's' : ''}`,
        );
      }
      for (const message of rejected) {
        toast.error(`Registro descartado — ${message}`);
      }
      refreshCount();
      syncingRef.current = false;
    })();
  }, [online, qc]);

  return { online, pendingCount, refreshCount };
}
