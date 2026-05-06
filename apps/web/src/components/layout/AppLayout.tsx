import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Link, useMatchRoute, useRouter } from '@tanstack/react-router';
import {
  BarChart2,
  Bell,
  BookOpen,
  Calendar,
  CalendarDays,
  Camera,
  CheckCircle2,
  FileCheck,
  Heart,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Shield,
  ShieldCheck,
  Trash2,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/cn';
import { SchoolSelector } from '@/components/ui/SchoolSelector';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useAuthStore, useUser } from '@/stores/auth.store';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  guardianOnly?: boolean;
  staffOnly?: boolean;
};

type NavGroup = { heading: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Operaciones',
    items: [
      { to: '/', label: 'Panel', icon: LayoutDashboard, exact: true, staffOnly: true },
      { to: '/mis-pupilos', label: 'Mis pupilos', icon: Heart, guardianOnly: true },
      { to: '/cursos', label: 'Cursos', icon: BookOpen, staffOnly: true },
      { to: '/justificaciones', label: 'Justificaciones', icon: FileCheck, staffOnly: true },
      { to: '/calendario', label: 'Calendario', icon: Calendar, staffOnly: true },
    ],
  },
  {
    heading: 'Análisis',
    items: [{ to: '/reportes', label: 'Reportes', icon: BarChart2, staffOnly: true }],
  },
  {
    heading: 'Administración',
    items: [
      { to: '/usuarios', label: 'Usuarios', icon: Users, adminOnly: true },
      { to: '/alertas', label: 'Alertas', icon: Bell, adminOnly: true },
      { to: '/correos', label: 'Correos', icon: Mail, adminOnly: true },
      { to: '/auditoria', label: 'Auditoría', icon: Shield, adminOnly: true },
      { to: '/papelera', label: 'Papelera', icon: Trash2, superAdminOnly: true },
    ],
  },
];

const TRIGGER_LABELS: Record<string, string> = {
  STUDENT_BELOW_THRESHOLD: 'Alumno bajo umbral',
  COURSE_BELOW_THRESHOLD: 'Curso bajo umbral',
  STUDENT_CONSECUTIVE_ABSENCES: 'Ausencias consecutivas',
  TEACHER_NO_RECORD: 'Sin registro docente',
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  DIRECTOR: 'Director',
  UTP: 'UTP',
  INSPECTORIA: 'Inspectoría',
  PROFESOR: 'Profesor/a',
  APODERADO: 'Apoderado/a',
};

type Profile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  schoolRoles: { schoolId: string; role: string }[];
  twoFactorEnabled: boolean;
};

function NotificationBell({ schoolId }: { schoolId?: string }) {
  const [open, setOpen] = useState(false);

  const { data: fired = [] } = useQuery({
    queryKey: ['recent-fired', schoolId],
    queryFn: () =>
      api.get<
        { id: string; firedAt: string; rule: { trigger: string; threshold: number | null } }[]
      >('/alerts/fired/recent'),
    enabled: !!schoolId,
    refetchInterval: 5 * 60 * 1000,
  });

  const last24h = fired.filter((f) => Date.now() - new Date(f.firedAt).getTime() < 86_400_000);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative size-9 flex items-center justify-center rounded-lg hover:bg-muted transition text-muted-foreground"
        title="Alertas recientes"
        aria-label="Alertas recientes"
      >
        <Bell className="size-4" />
        {last24h.length > 0 && (
          <span className="absolute top-1 right-1 size-2 rounded-full bg-red-500" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-border bg-background shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-sm font-semibold">Alertas recientes</p>
              {last24h.length > 0 && (
                <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full">
                  {last24h.length} hoy
                </span>
              )}
            </div>
            {fired.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                Sin alertas recientes
              </p>
            ) : (
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {fired.map((f) => (
                  <div key={f.id} className="px-4 py-3 text-sm">
                    <p className="font-medium">
                      {TRIGGER_LABELS[f.rule.trigger] ?? f.rule.trigger}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(f.firedAt).toLocaleDateString('es-CL', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {f.rule.threshold != null &&
                        ` · Umbral ${(f.rule.threshold * 100).toFixed(0)}%`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProfilePanel({
  open,
  onClose,
  fallbackEmail,
  fallbackRoleLabel,
}: {
  open: boolean;
  onClose: () => void;
  fallbackEmail: string | undefined;
  fallbackRoleLabel: string;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { data: profile } = useQuery<Profile>({
    queryKey: ['me'],
    queryFn: () => api.get('/users/me'),
    enabled: open,
  });

  const passwordMutation = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) throw new Error('Las contraseñas no coinciden');
      return api.post('/users/me/password', { currentPassword, newPassword });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Contraseña actualizada');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  if (!open) return null;

  const email = profile?.email ?? fallbackEmail ?? '';
  const initials =
    profile?.firstName || profile?.lastName
      ? `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase()
      : (email[0]?.toUpperCase() ?? 'U');
  const roles = profile?.schoolRoles.map((r) => ROLE_LABELS[r.role] ?? r.role) ?? [
    fallbackRoleLabel,
  ];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-3 top-6 mx-auto max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl sm:top-12">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <UserCircle className="size-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Perfil</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar perfil"
          >
            <X className="mx-auto size-4" />
          </button>
        </div>

        <div className="max-h-[calc(100vh-7rem)] overflow-y-auto p-4">
          <div className="flex items-center gap-3">
            <div className="relative size-16 rounded-full bg-primary/15 text-primary grid place-items-center text-lg font-semibold">
              {initials}
              <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border border-border bg-background text-muted-foreground">
                <Camera className="size-3" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {profile ? `${profile.firstName} ${profile.lastName}`.trim() || email : email}
              </p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {roles.map((role) => (
                  <span key={role} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-sm">
            <ProfileRow icon={Mail} label="Correo" value={email} />
            <ProfileRow
              icon={CheckCircle2}
              label="Estado"
              value={profile?.status === 'ACTIVE' ? 'Activo' : (profile?.status ?? 'Cargando')}
            />
            <ProfileRow
              icon={CalendarDays}
              label="Creado"
              value={formatDateTime(profile?.createdAt ?? null)}
            />
            <ProfileRow
              icon={ShieldCheck}
              label="2FA"
              value={profile?.twoFactorEnabled ? 'Activado' : 'No requerido/No activado'}
            />
            <ProfileRow
              icon={LogOut}
              label="Último acceso"
              value={formatDateTime(profile?.lastLoginAt ?? null)}
            />
          </div>

          <form
            className="mt-5 space-y-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              passwordMutation.mutate();
            }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4 text-muted-foreground" />
              Contraseña
            </div>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Contraseña actual"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              autoComplete="current-password"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nueva contraseña"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              autoComplete="new-password"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repetir nueva contraseña"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              autoComplete="new-password"
            />
            <button
              type="submit"
              disabled={
                passwordMutation.isPending ||
                !currentPassword ||
                newPassword.length < 12 ||
                !confirmPassword
              }
              className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {passwordMutation.isPending ? 'Guardando...' : 'Actualizar contraseña'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-xs font-medium">{value}</p>
      </div>
    </div>
  );
}

type Props = { children: React.ReactNode };

export function AppLayout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const logout = useAuthStore((s) => s.logout);
  const user = useUser();
  const online = useOnlineStatus();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    toast.success('Sesión cerrada');
    void router.navigate({ to: '/login', search: { reason: undefined } });
  };

  const roles = user?.roles ?? [];
  const isAdmin = roles.includes('SUPER_ADMIN') || roles.includes('DIRECTOR');
  const isGuardian = roles.includes('APODERADO');
  const isStaff = roles.some((r) =>
    ['SUPER_ADMIN', 'DIRECTOR', 'UTP', 'INSPECTORIA', 'PROFESOR'].includes(r),
  );

  const visible = (item: NavItem): boolean => {
    if (item.superAdminOnly && !roles.includes('SUPER_ADMIN')) return false;
    if (item.adminOnly && !isAdmin) return false;
    if (item.guardianOnly && !isGuardian) return false;
    if (item.staffOnly && !isStaff) return false;
    return true;
  };

  const roleLabel = (() => {
    const first = roles[0];
    if (!first) return '';
    return ROLE_LABELS[first] ?? first;
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-muted/40">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-background border-r border-border transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-3 px-5 border-b border-border">
          <img src="/logo-cssp.png" alt="CSSP" className="size-9 object-contain drop-shadow-sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">Asistencia CSSP</p>
            <p className="text-[11px] text-muted-foreground truncate">San Sebastián de Paine</p>
          </div>
          <button
            className="ml-auto lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
            aria-label="Cerrar menú"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <div key={group.heading} className="space-y-1">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      label={item.label}
                      Icon={item.icon}
                      exact={item.exact === true}
                      onClick={() => setSidebarOpen(false)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-border p-3 space-y-2">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg bg-muted/50 px-2 py-2 text-left transition hover:bg-muted"
          >
            <div className="size-8 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold">
              {user?.email?.[0]?.toUpperCase() ?? '·'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">{user?.email}</p>
              <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
            </div>
          </button>
          <button
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition"
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="flex h-16 items-center gap-2 overflow-hidden border-b border-border bg-background px-4 lg:gap-4 lg:px-6 shrink-0">
          <button
            className="shrink-0 lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1" />
          <div className="ml-auto flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
            {roles.includes('SUPER_ADMIN') && <SchoolSelector />}
            {isStaff && user?.schoolId && <NotificationBell schoolId={user.schoolId} />}
            <ThemeToggle />
          </div>
        </header>

        {!online && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2 shrink-0">
            <span className="inline-block size-2 rounded-full bg-amber-500 animate-pulse" />
            Sin conexión — los cambios se guardarán localmente y sincronizarán al reconectar.
          </div>
        )}
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
      <ProfilePanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        fallbackEmail={user?.email}
        fallbackRoleLabel={roleLabel}
      />
    </div>
  );
}

function NavLink({
  to,
  label,
  Icon,
  exact,
  onClick,
}: {
  to: string;
  label: string;
  Icon: React.FC<{ className?: string }>;
  exact?: boolean;
  onClick?: () => void;
}) {
  const match = useMatchRoute();
  const active = match({ to, fuzzy: !exact });

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </Link>
  );
}
