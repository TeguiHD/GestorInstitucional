import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { attendanceQueue } from '@/lib/attendance-queue';
import { useOnlineStatus } from './useOnlineStatus';

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
        } catch {
          // Keep in queue, retry next time
        }
      }
      toast.dismiss(toastId);
      if (synced > 0) {
        toast.success(
          `${synced} registro${synced !== 1 ? 's' : ''} sincronizado${synced !== 1 ? 's' : ''}`,
        );
      }
      refreshCount();
      syncingRef.current = false;
    })();
  }, [online, qc]);

  return { online, pendingCount, refreshCount };
}
