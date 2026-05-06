import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { api, uploadFormData } from '@/lib/api';

type Child = {
  id: string;
  firstName: string;
  lastName: string;
  rut: string;
  enrollmentNumber: number;
  course: { id: string; code: string; name: string };
  relation: string;
  isPrimary: boolean;
};

type Stats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  justified: number;
  attendanceRate: number;
};

type AttendanceRec = { id: string; date: string; status: string; note?: string };

type Justification = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  fileName: string;
  reason: string;
  createdAt: string;
  record: { date: string; status: string };
};

const STATUS_COLOR: Record<string, string> = {
  PRESENT: '#22c55e',
  ABSENT: '#ef4444',
  LATE: '#f97316',
  JUSTIFIED: '#eab308',
};
const MAX_JUSTIFICATION_FILE_SIZE_BYTES = 8 * 1024 * 1024;

export function MyChildrenPage() {
  const { data: children, isLoading } = useQuery<Child[]>({
    queryKey: ['my-children'],
    queryFn: () => api.get('/students/my-children'),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = children?.find((c) => c.id === (selectedId ?? children?.[0]?.id));

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mis pupilos</h1>
        <p className="text-sm text-muted-foreground">Asistencia y justificaciones</p>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse bg-muted rounded-xl" />
      ) : !children?.length ? (
        <div className="rounded-xl border border-border bg-background p-8 text-center text-sm text-muted-foreground">
          No hay alumnos asociados a tu cuenta. Contacta a dirección.
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            {children.map((c) => {
              const active = (selectedId ?? children[0]!.id) === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`rounded-lg px-4 py-2 text-sm transition ${active ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}
                >
                  {c.firstName} {c.lastName}{' '}
                  <span className="opacity-70 text-xs">· {c.course.code}</span>
                </button>
              );
            })}
          </div>
          {selected && <ChildDetail child={selected} />}
        </>
      )}
    </div>
  );
}

function ChildDetail({ child }: { child: Child }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<AttendanceRec | null>(null);
  const [reason, setReason] = useState('');

  const { data: stats } = useQuery<Stats>({
    queryKey: ['student-stats', child.id],
    queryFn: () => api.get(`/students/${child.id}/stats`),
  });

  const { data: records } = useQuery<AttendanceRec[]>({
    queryKey: ['student-records', child.id],
    queryFn: () => api.get(`/attendance/student/${child.id}`),
  });

  const { data: justifs } = useQuery<Justification[]>({
    queryKey: ['my-justifs', child.id],
    queryFn: () => api.get(`/justifications/student/${child.id}`),
  });

  const uploadMut = useMutation({
    mutationFn: async (v: { recordId: string; reason: string; file: File }) => {
      const fd = new FormData();
      fd.append('recordId', v.recordId);
      fd.append('reason', v.reason);
      fd.append('file', v.file);
      return uploadFormData('/justifications/upload', fd);
    },
    onSuccess: () => {
      toast.success('Certificado enviado');
      setUploadFor(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['my-justifs', child.id] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const justifsByRecordId = new Map<string, Justification>(
    (justifs ?? []).map((j) => [records?.find((r) => r.date === j.record.date)?.id ?? '', j]),
  );

  const rateColor =
    stats?.attendanceRate != null
      ? stats.attendanceRate >= 0.9
        ? '#22c55e'
        : stats.attendanceRate >= 0.7
          ? '#f59e0b'
          : '#ef4444'
      : '#888';

  return (
    <>
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="Asistencia"
            value={`${(stats.attendanceRate * 100).toFixed(1)}%`}
            color={rateColor}
          />
          <KpiCard label="Presentes" value={String(stats.present)} color="#22c55e" />
          <KpiCard label="Ausentes" value={String(stats.absent)} color="#ef4444" />
          <KpiCard label="Justificados" value={String(stats.justified)} color="#eab308" />
        </div>
      )}

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Historial de {child.firstName}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-5 py-3">Fecha</th>
                <th className="text-left px-5 py-3">Estado</th>
                <th className="text-left px-5 py-3">Justificación</th>
              </tr>
            </thead>
            <tbody>
              {records?.map((r) => {
                const j = justifsByRecordId.get(r.id);
                const canJustify = r.status === 'ABSENT' && !j;
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-5 py-2.5 tabular-nums">
                      {new Date(r.date + 'T12:00').toLocaleDateString('es-CL', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                      })}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: STATUS_COLOR[r.status] ?? '#888' }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      {j ? (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${j.status === 'APPROVED' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : j.status === 'REJECTED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}
                        >
                          {j.status === 'PENDING'
                            ? 'En revisión'
                            : j.status === 'APPROVED'
                              ? 'Aprobada'
                              : 'Rechazada'}
                        </span>
                      ) : canJustify ? (
                        <button
                          onClick={() => setUploadFor(r)}
                          className="text-xs flex items-center gap-1 text-primary hover:underline"
                        >
                          <Upload className="size-3" /> Justificar
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {uploadFor && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setUploadFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background rounded-xl border border-border w-full max-w-md p-5 space-y-4"
          >
            <h3 className="font-semibold">Justificar ausencia del {uploadFor.date}</h3>
            <textarea
              placeholder="Motivo (ej: enfermedad, control médico)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background min-h-20"
            />
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="w-full text-sm"
            />
            <p className="text-xs text-muted-foreground">PDF/PNG/JPG/WEBP · máx 8 MB</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setUploadFor(null)}
                className="text-sm px-4 py-1.5 rounded-lg border hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const f = fileRef.current?.files?.[0];
                  if (!f) {
                    toast.error('Selecciona un archivo');
                    return;
                  }
                  if (f.size > MAX_JUSTIFICATION_FILE_SIZE_BYTES) {
                    toast.error('El archivo supera 8 MB');
                    return;
                  }
                  if (!reason.trim()) {
                    toast.error('Escribe un motivo');
                    return;
                  }
                  uploadMut.mutate({ recordId: uploadFor.id, reason, file: f });
                }}
                disabled={uploadMut.isPending}
                className="text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
              >
                {uploadMut.isPending ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
