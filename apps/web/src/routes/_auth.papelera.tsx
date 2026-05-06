import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, FileCheck, GraduationCap, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { TypedConfirmDialog } from '@/components/ui/TypedConfirmDialog';
import { api } from '@/lib/api';
import { useAuthStore, useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';

export const Route = createFileRoute('/_auth/papelera')({
  beforeLoad: () => {
    const user = useAuthStore.getState().user;
    if (user && !user.roles.includes('SUPER_ADMIN')) throw redirect({ to: '/', replace: true });
  },
  component: PapeleraPage,
});

type Tab = 'usuarios' | 'alumnos' | 'justificaciones';

type TrashedUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  deletedAt: string;
  schoolRoles: { role: string }[];
};

type TrashedStudent = {
  id: string;
  firstName: string;
  lastName: string;
  rut: string;
  enrollmentNumber: number;
  withdrawnAt: string | null;
  course: { code: string; name: string };
};

type TrashedJustification = {
  id: string;
  fileName: string;
  reason: string;
  deletedAt: string;
  record: {
    date: string;
    student: {
      firstName: string;
      lastName: string;
      rut: string;
      course: { code: string };
    };
  };
  uploadedBy: { firstName: string; lastName: string; email: string };
};

const QUERY_KEY_BY_TAB: Record<Tab, string> = {
  usuarios: 'users',
  alumnos: 'students',
  justificaciones: 'justifications',
};

function PapeleraPage() {
  const user = useUser();
  const schoolId = useEffectiveSchoolId();
  const [tab, setTab] = useState<Tab>('usuarios');
  const [purgeTarget, setPurgeTarget] = useState<{ id: string; entity: Tab; label: string } | null>(
    null,
  );
  const qc = useQueryClient();

  const usersQ = useQuery<TrashedUser[]>({
    queryKey: ['trash', 'users', schoolId],
    queryFn: () => api.get<TrashedUser[]>(`/users/trash?schoolId=${encodeURIComponent(schoolId)}`),
    enabled: tab === 'usuarios' && !!schoolId,
  });

  const studentsQ = useQuery<TrashedStudent[]>({
    queryKey: ['trash', 'students', schoolId],
    queryFn: () =>
      api.get<TrashedStudent[]>(`/students/trash?schoolId=${encodeURIComponent(schoolId)}`),
    enabled: tab === 'alumnos' && !!schoolId,
  });

  const justificationsQ = useQuery<TrashedJustification[]>({
    queryKey: ['trash', 'justifications', schoolId],
    queryFn: () =>
      api.get<TrashedJustification[]>(
        `/justifications/trash?schoolId=${encodeURIComponent(schoolId)}`,
      ),
    enabled: tab === 'justificaciones' && !!schoolId,
  });

  const restore = useMutation({
    mutationFn: ({ id, entity }: { id: string; entity: Tab }) =>
      api.post(pathFor(entity, id, 'restore'), {}),
    onSuccess: (_data, { entity }) => {
      toast.success('Restaurado correctamente');
      void qc.invalidateQueries({ queryKey: ['trash', QUERY_KEY_BY_TAB[entity], schoolId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const purge = useMutation({
    mutationFn: ({ id, entity }: { id: string; entity: Tab }) =>
      api.del(pathFor(entity, id, 'purge')),
    onSuccess: (_data, { entity }) => {
      toast.success('Purgado definitivamente');
      setPurgeTarget(null);
      void qc.invalidateQueries({ queryKey: ['trash', QUERY_KEY_BY_TAB[entity], schoolId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!user?.roles.includes('SUPER_ADMIN')) return null;

  const tabs: { id: Tab; label: string; Icon: typeof Users }[] = [
    { id: 'usuarios', label: 'Usuarios', Icon: Users },
    { id: 'alumnos', label: 'Alumnos', Icon: GraduationCap },
    { id: 'justificaciones', label: 'Justificaciones', Icon: FileCheck },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Papelera</h1>
          <p className="text-sm text-muted-foreground">Restauración y purga definitiva.</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {!schoolId ? (
        <div className="rounded-lg border border-border bg-background p-8 text-center text-sm text-muted-foreground">
          Selecciona un colegio.
        </div>
      ) : tab === 'usuarios' ? (
        <TrashTable
          loading={usersQ.isLoading}
          emptyMsg="Sin usuarios eliminados"
          rows={(usersQ.data ?? []).map((item) => ({
            id: item.id,
            primary: `${item.firstName} ${item.lastName}`,
            secondary: item.email,
            badge: item.schoolRoles[0]?.role ?? 'Sin rol',
            deletedAt: item.deletedAt,
          }))}
          onRestore={(id) => restore.mutate({ id, entity: 'usuarios' })}
          onPurge={(id, label) => setPurgeTarget({ id, entity: 'usuarios', label })}
        />
      ) : tab === 'alumnos' ? (
        <TrashTable
          loading={studentsQ.isLoading}
          emptyMsg="Sin alumnos retirados"
          rows={(studentsQ.data ?? []).map((item) => ({
            id: item.id,
            primary: `${item.firstName} ${item.lastName}`,
            secondary: `${item.rut} · ${item.course.code} · N° ${item.enrollmentNumber}`,
            badge: 'Retirado',
            deletedAt: item.withdrawnAt ?? '',
          }))}
          onRestore={(id) => restore.mutate({ id, entity: 'alumnos' })}
          onPurge={(id, label) => setPurgeTarget({ id, entity: 'alumnos', label })}
        />
      ) : (
        <TrashTable
          loading={justificationsQ.isLoading}
          emptyMsg="Sin justificaciones eliminadas"
          rows={(justificationsQ.data ?? []).map((item) => ({
            id: item.id,
            primary: `${item.record.student.firstName} ${item.record.student.lastName}`,
            secondary: `${item.record.student.course.code} · ${formatDate(item.record.date)} · ${item.reason.slice(0, 72)}`,
            badge: 'Eliminada',
            deletedAt: item.deletedAt,
          }))}
          onRestore={(id) => restore.mutate({ id, entity: 'justificaciones' })}
          onPurge={(id, label) => setPurgeTarget({ id, entity: 'justificaciones', label })}
        />
      )}

      <TypedConfirmDialog
        open={!!purgeTarget}
        onOpenChange={(open) => {
          if (!open) setPurgeTarget(null);
        }}
        title="Purgar definitivamente"
        description={
          <p>
            Los datos personales de{' '}
            <strong className="text-foreground">{purgeTarget?.label}</strong> serán anonimizados de
            forma irreversible.
          </p>
        }
        onConfirm={() =>
          purgeTarget && purge.mutate({ id: purgeTarget.id, entity: purgeTarget.entity })
        }
        loading={purge.isPending}
      />
    </div>
  );
}

function TrashTable({
  loading,
  emptyMsg,
  rows,
  onRestore,
  onPurge,
}: {
  loading: boolean;
  emptyMsg: string;
  rows: { id: string; primary: string; secondary: string; badge: string; deletedAt: string }[];
  onRestore: (id: string) => void;
  onPurge: (id: string, label: string) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-border py-3 last:border-0"
          >
            <div className="size-9 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-44 animate-pulse rounded bg-muted" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center text-sm text-muted-foreground">
        {emptyMsg}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 text-left">Elemento</th>
              <th className="hidden px-5 py-3 text-left sm:table-cell">Estado</th>
              <th className="hidden px-5 py-3 text-left lg:table-cell">Fecha</th>
              <th className="w-48 px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-5 py-3.5">
                  <p className="font-medium">{row.primary}</p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{row.secondary}</p>
                </td>
                <td className="hidden px-5 py-3.5 sm:table-cell">
                  <Badge>{row.badge}</Badge>
                </td>
                <td className="hidden px-5 py-3.5 text-xs text-muted-foreground lg:table-cell">
                  {row.deletedAt ? formatDate(row.deletedAt) : '-'}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onRestore(row.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <ArchiveRestore className="size-3.5" />
                      Restaurar
                    </button>
                    <button
                      type="button"
                      onClick={() => onPurge(row.id, row.primary)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
                    >
                      <Trash2 className="size-3.5" />
                      Purgar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function pathFor(entity: Tab, id: string, action: 'restore' | 'purge') {
  const base =
    entity === 'usuarios'
      ? `/users/${id}`
      : entity === 'alumnos'
        ? `/students/${id}`
        : `/justifications/${id}`;
  return `${base}/${action}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
