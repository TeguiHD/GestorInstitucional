import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useRef } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  MoreVertical,
  Plus,
  Search,
  Shield,
  Unlock,
  UserX,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

export const Route = createFileRoute('/_auth/usuarios')({
  component: UsersPage,
});

type SchoolRole = { role: string };
type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status: string;
  lastLoginAt: string | null;
  schoolRoles: SchoolRole[];
  twoFactorEnabled?: boolean;
};

type SystemRole = 'SUPER_ADMIN' | 'DIRECTOR' | 'UTP' | 'PROFESOR' | 'APODERADO';

const ROLES: SystemRole[] = ['DIRECTOR', 'UTP', 'PROFESOR', 'APODERADO'];

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  DIRECTOR: 'Director/a',
  UTP: 'UTP',
  PROFESOR: 'Profesor/a',
  APODERADO: 'Apoderado/a',
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  DIRECTOR: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  UTP: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  PROFESOR: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  APODERADO: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const ROLE_INITIALS_BG: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-500',
  DIRECTOR: 'bg-green-600',
  UTP: 'bg-blue-500',
  PROFESOR: 'bg-orange-500',
  APODERADO: 'bg-gray-400',
};

function timeAgo(date: string | null): string {
  if (!date) return 'Nunca';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `Hace ${days} día${days !== 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  return `Hace ${months} mes${months !== 1 ? 'es' : ''}`;
}

function Avatar({ user }: { user: User }) {
  const primaryRole = user.schoolRoles[0]?.role ?? 'APODERADO';
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const bg = ROLE_INITIALS_BG[primaryRole] ?? 'bg-gray-400';
  return (
    <div
      className={`size-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 ${bg}`}
    >
      {initials}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[role] ?? ROLE_COLORS.APODERADO}`}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    INACTIVE: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    LOCKED: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  };
  const labels: Record<string, string> = {
    ACTIVE: 'Activo',
    INACTIVE: 'Inactivo',
    LOCKED: 'Bloqueado',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.INACTIVE}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

// ── Kebab menu ──────────────────────────────────────────────────────────────
function ActionMenu({
  user,
  onEdit,
  onToggleStatus,
  onUnlock,
  onResetPassword,
  onDelete,
  canEdit,
}: {
  user: User;
  onEdit: () => void;
  onToggleStatus: () => void;
  onUnlock: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({
    right: 0,
  });
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!canEdit) return null;

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const MENU_H = 252;
      const spaceBelow = window.innerHeight - r.bottom;
      if (spaceBelow < MENU_H) {
        setMenuPos({ bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right });
      } else {
        setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
      }
    }
    setOpen((v) => !v);
  };

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="fixed z-20 w-48 rounded-xl border border-border bg-background shadow-lg py-1 text-sm"
            style={{ top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right }}
          >
            <button
              onClick={() => {
                onEdit();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted transition-colors"
            >
              Editar usuario
            </button>
            {user.status === 'LOCKED' && (
              <button
                onClick={() => {
                  onUnlock();
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-2 hover:bg-muted transition-colors flex items-center gap-2"
              >
                <Unlock className="h-3.5 w-3.5" /> Desbloquear
              </button>
            )}
            <button
              onClick={() => {
                onToggleStatus();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted transition-colors"
            >
              {user.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}
            </button>
            <button
              onClick={() => {
                onResetPassword();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted transition-colors flex items-center gap-2"
            >
              <KeyRound className="h-3.5 w-3.5" /> Resetear contraseña
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={() => {
                onDelete();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-destructive flex items-center gap-2"
            >
              <UserX className="h-3.5 w-3.5" /> Eliminar usuario
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Create / Edit modal ──────────────────────────────────────────────────────
type ModalState =
  | { type: 'create' }
  | { type: 'edit'; user: User }
  | { type: 'password'; userId: string; tempPassword: string }
  | null;

function UserModal({
  state,
  schoolId,
  onClose,
  onSuccess,
}: {
  state: ModalState;
  schoolId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState(state?.type === 'edit' ? state.user.firstName : '');
  const [lastName, setLastName] = useState(state?.type === 'edit' ? state.user.lastName : '');
  const [email, setEmail] = useState(state?.type === 'edit' ? state.user.email : '');
  const [phone, setPhone] = useState(state?.type === 'edit' ? (state.user.phone ?? '') : '');
  const [role, setRole] = useState<SystemRole>(
    state?.type === 'edit'
      ? ((state.user.schoolRoles[0]?.role as SystemRole) ?? 'APODERADO')
      : 'APODERADO',
  );
  const [sendWelcome, setSendWelcome] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const create = useMutation({
    mutationFn: (body: object) => api.post('/users', body),
    onSuccess: (data: unknown) => {
      qc.invalidateQueries({ queryKey: ['users', schoolId] });
      const d = data as { tempPassword?: string; id?: string };
      if (d.tempPassword) {
        onSuccess();
      } else {
        toast.success('Usuario creado', {
          description: 'Se envió email de bienvenida con contraseña temporal.',
        });
        onClose();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & object) => api.patch(`/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', schoolId] });
      toast.success('Usuario actualizado', {
        description: `${firstName} ${lastName} — cambios guardados.`,
      });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editRoles = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & object) => api.patch(`/users/${id}/roles`, body),
  });

  if (state?.type === 'password') {
    const copy = () => {
      navigator.clipboard.writeText(state.tempPassword).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };
    return (
      <Modal onClose={onClose} title="Contraseña temporal generada">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Comparte esta contraseña con el usuario. No podrá verla después.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <code className="flex-1 text-sm font-mono tracking-wider">
              {showPass ? state.tempPassword : '••••••••'}
            </code>
            <button
              onClick={() => setShowPass((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button onClick={copy} className="text-muted-foreground hover:text-foreground">
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            Listo
          </button>
        </div>
      </Modal>
    );
  }

  const isEdit = state?.type === 'edit';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit && state?.type === 'edit') {
      await (edit.mutateAsync as (v: object) => Promise<unknown>)({
        id: state.user.id,
        firstName,
        lastName,
        phone,
      });
      await (editRoles.mutateAsync as (v: object) => Promise<unknown>)({
        id: state.user.id,
        roles: [role],
        schoolId,
      });
    } else {
      const data = (await create.mutateAsync({
        email,
        firstName,
        lastName,
        schoolId,
        role,
        sendWelcomeEmail: sendWelcome,
      })) as { tempPassword?: string; id?: string };
      if (data?.tempPassword) {
        // Trigger password reveal modal
        qc.invalidateQueries({ queryKey: ['users', schoolId] });
        onSuccess();
        return;
      }
    }
  }

  return (
    <Modal onClose={onClose} title={isEdit ? 'Editar usuario' : 'Nuevo usuario'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Nombre</label>
            <input
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Juan"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Apellido</label>
            <input
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Pérez"
            />
          </div>
        </div>
        {isEdit && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Teléfono (WhatsApp)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="+56912345678"
            />
          </div>
        )}
        {!isEdit && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="juan.perez@ejemplo.com"
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Rol</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as SystemRole)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        {!isEdit && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={sendWelcome}
              onChange={(e) => setSendWelcome(e.target.checked)}
              className="h-4 w-4"
            />
            Enviar email de bienvenida con contraseña temporal
          </label>
        )}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={create.isPending || edit.isPending}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            {create.isPending || edit.isPending
              ? 'Guardando…'
              : isEdit
                ? 'Guardar cambios'
                : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xl">
        <h2 className="text-base font-semibold mb-5">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
function UsersPage() {
  const currentUser = useUser();
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();
  const canEdit = currentUser?.roles?.some((r) => ['SUPER_ADMIN', 'DIRECTOR'].includes(r)) ?? false;

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('Todos');
  const [modal, setModal] = useState<ModalState>(null);
  const [pendingPassword, setPendingPassword] = useState<{
    userId: string;
    tempPassword: string;
  } | null>(null);

  const {
    data: users = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<User[]>({
    queryKey: ['users', schoolId],
    queryFn: () => api.get(`/users?schoolId=${schoolId}`),
    enabled: !!schoolId,
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/users/${id}`, { status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', schoolId] });
      toast.success('Estado actualizado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlock = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/unlock`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', schoolId] });
      toast.success('Cuenta desbloqueada');
    },
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/reset-password`, {}),
    onSuccess: (data: unknown, id: string) => {
      const d = data as { tempPassword: string };
      setPendingPassword({ userId: id, tempPassword: d.tempPassword });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', schoolId] });
      toast.success('Usuario eliminado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchRole = filterRole === 'Todos' || u.schoolRoles.some((r) => r.role === filterRole);
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        u.firstName.toLowerCase().includes(q) ||
        u.lastName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q);
      return matchRole && matchSearch;
    });
  }, [users, search, filterRole]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { Todos: users.length };
    for (const u of users)
      for (const r of u.schoolRoles) counts[r.role] = (counts[r.role] ?? 0) + 1;
    return counts;
  }, [users]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona las cuentas y roles del colegio
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setModal({ type: 'create' })}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nuevo usuario
          </button>
        )}
      </div>

      {/* Mail categories explanation */}
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <Shield className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
        <span>
          <strong className="text-foreground">Categorías de correo masivo</strong> — se generan
          automáticamente según el rol: "Todos los apoderados" = rol Apoderado/a · "Solo staff" =
          Director/a + UTP + Profesor/a · "Toda la comunidad" = todos.
        </span>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['Todos', ...ROLES].map((r) => (
            <button
              key={r}
              onClick={() => setFilterRole(r)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                filterRole === r
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border bg-background hover:bg-muted'
              }`}
            >
              {r === 'Todos' ? 'Todos' : ROLE_LABELS[r]}{' '}
              {roleCounts[r] != null ? `(${roleCounts[r]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {!schoolId ? (
        <EmptyState
          icon={Users}
          title="Sin colegio asignado"
          description="Tu cuenta no está vinculada a un colegio."
        />
      ) : isLoading ? (
        <div className="rounded-xl border border-border overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-0"
            >
              <div className="size-9 rounded-full animate-pulse bg-muted flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 animate-pulse bg-muted rounded w-40" />
                <div className="h-3 animate-pulse bg-muted rounded w-56" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="No se pudieron cargar los usuarios." onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search || filterRole !== 'Todos' ? 'Sin resultados' : 'Sin usuarios'}
          description={
            search || filterRole !== 'Todos'
              ? 'Prueba ajustando los filtros.'
              : 'Aún no hay usuarios en este colegio.'
          }
          action={
            canEdit && !search && filterRole === 'Todos'
              ? { label: 'Crear primer usuario', onClick: () => setModal({ type: 'create' }) }
              : undefined
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <th className="text-left px-5 py-3">Usuario</th>
                <th className="text-left px-5 py-3 hidden md:table-cell">Rol</th>
                <th className="text-left px-5 py-3 hidden lg:table-cell">Último acceso</th>
                <th className="text-left px-5 py-3">Estado</th>
                <th className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-border hover:bg-muted/20 transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar user={u} />
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {u.firstName} {u.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {u.schoolRoles.length > 0 ? (
                        u.schoolRoles.map((r) => <RoleBadge key={r.role} role={r.role} />)
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell text-xs text-muted-foreground">
                    {timeAgo(u.lastLoginAt)}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={u.status} />
                      {u.status === 'LOCKED' && <Lock className="h-3 w-3 text-destructive" />}
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <ActionMenu
                      user={u}
                      canEdit={canEdit}
                      onEdit={() => setModal({ type: 'edit', user: u })}
                      onToggleStatus={() => toggleStatus.mutate({ id: u.id, status: u.status })}
                      onUnlock={() => unlock.mutate(u.id)}
                      onResetPassword={() => resetPassword.mutate(u.id)}
                      onDelete={() => {
                        if (
                          window.confirm(
                            `¿Eliminar a ${u.firstName} ${u.lastName}? Esta acción no se puede deshacer.`,
                          )
                        ) {
                          remove.mutate(u.id);
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            {filtered.length} de {users.length} usuario{users.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Modals */}
      {modal && modal.type !== 'password' && (
        <UserModal
          state={modal}
          schoolId={schoolId}
          onClose={() => setModal(null)}
          onSuccess={() => {
            setModal(null);
          }}
        />
      )}
      {pendingPassword && (
        <UserModal
          state={{
            type: 'password',
            userId: pendingPassword.userId,
            tempPassword: pendingPassword.tempPassword,
          }}
          schoolId={schoolId}
          onClose={() => setPendingPassword(null)}
          onSuccess={() => setPendingPassword(null)}
        />
      )}
    </div>
  );
}
