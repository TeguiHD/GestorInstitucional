import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, Download, FileText, Search, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { EmptyState } from '@/components/ui/EmptyState';

type JustStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type Justification = {
  id: string;
  status: JustStatus;
  reason: string;
  reviewNotes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  fileName: string;
  mimeType: string;
  record: {
    date: string;
    student: {
      id: string;
      firstName: string;
      lastName: string;
      rut: string;
      course: { code: string; name: string };
    };
  };
  uploadedBy: { firstName: string; lastName: string };
  reviewedBy: { firstName: string; lastName: string } | null;
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
    color: 'text-red-600   bg-red-50   dark:bg-red-900/20',
    icon: XCircle,
  },
};

const PAGE_SIZE = 50;

type PagedResult = { items: Justification[]; total: number; limit: number; offset: number };

export function JustificationsPage() {
  const user = useUser();
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();
  const canReview =
    user?.roles?.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP'].includes(r)) ?? false;

  const [tab, setTab] = useState<JustStatus | 'ALL'>('PENDING');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [notes, setNotes] = useState('');

  const statusParam = tab === 'ALL' ? undefined : tab;

  const { data, isLoading } = useQuery<PagedResult>({
    queryKey: ['justifications', schoolId, tab, page],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (statusParam) params.set('status', statusParam);
      return api.get(`/justifications/school/${schoolId}?${params.toString()}`);
    },
    enabled: !!schoolId,
  });

  const { data: pendingData } = useQuery<PagedResult>({
    queryKey: ['justifications', schoolId, 'PENDING', 0],
    queryFn: () => api.get(`/justifications/school/${schoolId}?status=PENDING&limit=1&offset=0`),
    enabled: !!schoolId,
  });

  const review = useMutation({
    mutationFn: ({ id, decision, notes }: { id: string; decision: string; notes?: string }) =>
      api.patch(`/justifications/${id}/review`, { decision, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['justifications', schoolId] });
      toast.success('Justificación revisada');
      setReviewId(null);
      setDecision(null);
      setNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingCount = pendingData?.total ?? 0;
  const allItems = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const displayed = allItems.filter((j) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${j.record.student.firstName} ${j.record.student.lastName}`.toLowerCase();
    return (
      name.includes(q) ||
      j.record.student.rut.includes(q) ||
      j.record.student.course.code.toLowerCase().includes(q)
    );
  });

  const TABS: { key: JustStatus | 'ALL'; label: string }[] = [
    { key: 'PENDING', label: pendingCount > 0 ? `Pendientes (${pendingCount})` : 'Pendientes' },
    { key: 'APPROVED', label: 'Aprobadas' },
    { key: 'REJECTED', label: 'Rechazadas' },
    { key: 'ALL', label: 'Todas' },
  ];

  function switchTab(next: JustStatus | 'ALL') {
    setTab(next);
    setPage(0);
    setSearch('');
  }

  const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Justificaciones</h1>
        <p className="text-sm text-muted-foreground mt-1">Certificados enviados por apoderados</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Alumno, RUT o curso…"
          className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* List */}
      {!schoolId ? (
        <EmptyState
          icon={FileText}
          title="Sin colegio asignado"
          description="Tu cuenta no está vinculada a un colegio."
        />
      ) : isLoading ? (
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
        <div className="space-y-3" key={`${tab}-${page}`}>
          {displayed.map((j) => {
            const cfg = STATUS_CONFIG[j.status];
            const Icon = cfg.icon;
            const isReviewing = reviewId === j.id;

            return (
              <div
                key={j.id}
                className="rounded-xl border border-border bg-background p-5 space-y-0"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        {j.record.student.lastName}, {j.record.student.firstName}
                      </span>
                      <span className="text-xs text-muted-foreground">{j.record.student.rut}</span>
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                        {j.record.student.course.code}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${cfg.color}`}
                      >
                        <Icon className="h-3 w-3" /> {cfg.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Ausencia:{' '}
                      <strong>
                        {new Date(j.record.date + 'T12:00').toLocaleDateString('es-CL', {
                          dateStyle: 'long',
                        })}
                      </strong>
                      {' · '}Enviada el {new Date(j.createdAt).toLocaleDateString('es-CL')}
                      {' · '}Por {j.uploadedBy.firstName} {j.uploadedBy.lastName}
                      {j.reviewedBy &&
                        ` · Revisada por ${j.reviewedBy.firstName} ${j.reviewedBy.lastName}`}
                    </p>
                    <p className="text-sm mt-2 text-foreground">{j.reason}</p>
                    {j.reviewNotes && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        Nota del revisor: {j.reviewNotes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={`${API_BASE}/justifications/${j.id}/file`}
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
                          setNotes('');
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        {isReviewing ? 'Cancelar' : 'Revisar'}
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
                          onClick={() => setDecision(decision === d ? null : d)}
                          className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
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
                      placeholder="Nota para el apoderado (opcional)…"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex justify-end">
                      <button
                        disabled={!decision || review.isPending}
                        onClick={() =>
                          decision &&
                          review.mutate({ id: j.id, decision, ...(notes ? { notes } : {}) })
                        }
                        className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {review.isPending ? 'Guardando…' : 'Confirmar decisión'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted transition-colors"
            >
              ← Anterior
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
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
