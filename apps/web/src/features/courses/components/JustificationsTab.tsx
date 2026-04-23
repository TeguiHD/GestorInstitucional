import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, Clock, Download, FileText, XCircle } from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useUser } from '@/stores/auth.store';

type Student = { id: string; firstName: string; lastName: string };

type AttendanceRecord = {
  id: string;
  date: string;
  status: string;
  student: Student;
};

type Justification = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string;
  notes?: string;
  reviewNotes?: string;
  createdAt: string;
  record: AttendanceRecord;
  fileUrl?: string;
};

const STATUS_CONFIG = {
  PENDING: {
    label: 'Pendiente',
    icon: Clock,
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  APPROVED: {
    label: 'Aprobado',
    icon: CheckCircle2,
    cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  REJECTED: {
    label: 'Rechazado',
    icon: XCircle,
    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
};

const REASON_LABELS: Record<string, string> = {
  MEDICAL: 'Médico',
  FAMILY: 'Familiar',
  EMERGENCY: 'Emergencia',
  SPORTS_EVENT: 'Evento deportivo',
  OTHER: 'Otro',
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function JustificationsTab({
  courseId,
  students,
}: {
  courseId: string;
  students: { id: string }[];
}) {
  const user = useUser();
  const qc = useQueryClient();
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP'].includes(r));

  const studentIds = new Set(students.map((s) => s.id));

  const { data: all = [], isLoading } = useQuery<Justification[]>({
    queryKey: ['justifications-school', user?.schoolId],
    queryFn: () => api.get(`/justifications/school/${user?.schoolId}`),
    enabled: !!user?.schoolId,
    staleTime: 1000 * 60 * 2,
  });

  const courseJustifications = all.filter((j) => studentIds.has(j.record.student.id));

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      decision,
      notes,
    }: {
      id: string;
      decision: 'APPROVED' | 'REJECTED';
      notes?: string;
    }) => api.patch(`/justifications/${id}/review`, { decision, notes }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['justifications-school', user?.schoolId] }),
  });

  const pending = courseJustifications.filter((j) => j.status === 'PENDING');
  const rest = courseJustifications.filter((j) => j.status !== 'PENDING');

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  if (courseJustifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <FileText className="size-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">Sin justificaciones</p>
        <p className="text-xs text-muted-foreground">
          No hay justificaciones registradas para este curso.
        </p>
      </div>
    );
  }

  const JustificationCard = ({ j }: { j: Justification }) => {
    const cfg = STATUS_CONFIG[j.status];
    const Icon = cfg.icon;

    return (
      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to="/alumnos/$studentId"
                params={{ studentId: j.record.student.id }}
                search={{ courseId }}
                className="font-semibold text-sm hover:text-primary transition-colors"
              >
                {j.record.student.lastName}, {j.record.student.firstName}
              </Link>
              <span className="text-xs text-muted-foreground">{formatDate(j.record.date)}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">
                {REASON_LABELS[j.reason] ?? j.reason}
              </span>
            </div>
            {j.notes && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{j.notes}</p>
            )}
            {j.reviewNotes && (
              <p className="text-xs text-muted-foreground mt-1 italic">Revisión: {j.reviewNotes}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {j.fileUrl && (
              <a
                href={`/api/v1/justifications/${j.id}/file`}
                className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition"
                title="Descargar archivo"
              >
                <Download className="size-4" />
              </a>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                cfg.cls,
              )}
            >
              <Icon className="size-3" />
              {cfg.label}
            </span>
          </div>
        </div>

        {isAdmin && j.status === 'PENDING' && (
          <div className="flex gap-2 pt-1 border-t border-border">
            <button
              onClick={() => reviewMutation.mutate({ id: j.id, decision: 'APPROVED' })}
              disabled={reviewMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition disabled:opacity-50"
            >
              <CheckCircle2 className="size-3.5" />
              Aprobar
            </button>
            <button
              onClick={() => reviewMutation.mutate({ id: j.id, decision: 'REJECTED' })}
              disabled={reviewMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition disabled:opacity-50"
            >
              <XCircle className="size-3.5" />
              Rechazar
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-3 flex items-center gap-2">
            <Clock className="size-4" />
            Pendientes de revisión ({pending.length})
          </h3>
          <div className="space-y-3">
            {pending.map((j) => (
              <JustificationCard key={j.id} j={j} />
            ))}
          </div>
        </section>
      )}
      {rest.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            Historial ({rest.length})
          </h3>
          <div className="space-y-3">
            {rest.map((j) => (
              <JustificationCard key={j.id} j={j} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
