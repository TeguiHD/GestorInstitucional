import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Link, useMatchRoute, useRouter } from '@tanstack/react-router';
import {
  BarChart2,
  Bell,
  BookOpen,
  Calendar,
  FileCheck,
  Heart,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Shield,
  Trash2,
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

type Props = { children: React.ReactNode };

export function AppLayout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  const isStaff = roles.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP', 'PROFESOR'].includes(r));

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
    const map: Record<string, string> = {
      SUPER_ADMIN: 'Super admin',
      DIRECTOR: 'Director',
      UTP: 'UTP',
      PROFESOR: 'Profesor/a',
      APODERADO: 'Apoderado/a',
    };
    return map[first] ?? first;
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
          <div className="flex items-center gap-3 rounded-lg px-2 py-2 bg-muted/50">
            <div className="size-8 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold">
              {user?.email?.[0]?.toUpperCase() ?? '·'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">{user?.email}</p>
              <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
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
