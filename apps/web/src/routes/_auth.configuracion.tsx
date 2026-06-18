import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Settings,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { SchoolSelector } from '@/components/ui/SchoolSelector';
import { ApiError, api, downloadBlob } from '@/lib/api';
import { useAuthStore, useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';

export const Route = createFileRoute('/_auth/configuracion')({
  beforeLoad: () => {
    const user = useAuthStore.getState().user;
    if (user && !user.roles.includes('SUPER_ADMIN')) throw redirect({ to: '/', replace: true });
  },
  component: ConfiguracionPage,
});

type AcademicYearConfig = {
  schoolId: string;
  year: number;
  source: 'saved' | 'default';
  firstSemester: { startDate: string; endDate: string };
  secondSemester: { startDate: string; endDate: string };
  annual: { ranges: Array<{ startDate: string; endDate: string }> };
};

type FormState = {
  firstSemesterStart: string;
  firstSemesterEnd: string;
  secondSemesterStart: string;
  secondSemesterEnd: string;
};

const currentYear = new Date().getFullYear();

function ConfiguracionPage() {
  const user = useUser();
  const schoolId = useEffectiveSchoolId();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'calendar' | 'backup'>('calendar');
  const [year, setYear] = useState(currentYear);
  const [form, setForm] = useState<FormState>({
    firstSemesterStart: '',
    firstSemesterEnd: '',
    secondSemesterStart: '',
    secondSemesterEnd: '',
  });

  const { data: config, isLoading } = useQuery<AcademicYearConfig>({
    queryKey: ['school-academic-year-config', schoolId, year],
    queryFn: () => api.get(`/school-config/${schoolId}/academic-year/${year}`),
    enabled: !!schoolId,
  });

  useEffect(() => {
    if (!config) return;
    setForm({
      firstSemesterStart: config.firstSemester.startDate,
      firstSemesterEnd: config.firstSemester.endDate,
      secondSemesterStart: config.secondSemester.startDate,
      secondSemesterEnd: config.secondSemester.endDate,
    });
  }, [config]);

  const save = useMutation({
    mutationFn: (body: FormState) =>
      api.put<AcademicYearConfig>(`/school-config/${schoolId}/academic-year/${year}`, body),
    onSuccess: (saved) => {
      toast.success('Configuración escolar guardada');
      void qc.setQueryData(['school-academic-year-config', schoolId, year], saved);
      void qc.invalidateQueries({ queryKey: ['school-academic-year-config', schoolId, year] });
      void qc.invalidateQueries({ queryKey: ['course-summary-report'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const conflict = useMemo(() => conflictFromError(save.error), [save.error]);
  const hasChanges =
    !!config &&
    (form.firstSemesterStart !== config.firstSemester.startDate ||
      form.firstSemesterEnd !== config.firstSemester.endDate ||
      form.secondSemesterStart !== config.secondSemester.startDate ||
      form.secondSemesterEnd !== config.secondSemester.endDate);

  if (!user?.roles.includes('SUPER_ADMIN')) return null;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuración del sistema</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Administración del año académico escolar y copias de seguridad de datos.
          </p>
        </div>
      </div>

      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('calendar')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-2 ${
            activeTab === 'calendar'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <CalendarDays className="size-4" />
          Calendario Académico
        </button>
        <button
          onClick={() => setActiveTab('backup')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-2 ${
            activeTab === 'backup'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Database className="size-4" />
          Copias de Seguridad (Backup)
        </button>
      </div>

      {activeTab === 'calendar' ? (
        <div className="space-y-5">
          <div className="flex justify-end">
            <SchoolSelector />
          </div>

          <div className="rounded-xl border border-border bg-background overflow-hidden">
            <div className="border-b border-border px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                  <Settings className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Año escolar</h2>
                  <p className="text-xs text-muted-foreground">
                    {config?.source === 'saved' ? 'Configuración guardada' : 'Valores por defecto'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="year">
                  Año
                </label>
                <input
                  id="year"
                  type="number"
                  min={2020}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            {!schoolId ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Selecciona un colegio para gestionar sus fechas.
              </div>
            ) : isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : (
              <form
                className="p-5 space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  save.mutate(form);
                }}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <SemesterFieldset
                    title="Primer semestre"
                    startId="firstSemesterStart"
                    endId="firstSemesterEnd"
                    startValue={form.firstSemesterStart}
                    endValue={form.firstSemesterEnd}
                    onStartChange={(value) =>
                      setForm((current) => ({ ...current, firstSemesterStart: value }))
                    }
                    onEndChange={(value) =>
                      setForm((current) => ({ ...current, firstSemesterEnd: value }))
                    }
                  />
                  <SemesterFieldset
                    title="Segundo semestre"
                    startId="secondSemesterStart"
                    endId="secondSemesterEnd"
                    startValue={form.secondSemesterStart}
                    endValue={form.secondSemesterEnd}
                    onStartChange={(value) =>
                      setForm((current) => ({ ...current, secondSemesterStart: value }))
                    }
                    onEndChange={(value) =>
                      setForm((current) => ({ ...current, secondSemesterEnd: value }))
                    }
                  />
                </div>

                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <CalendarDays className="size-4 text-muted-foreground" />
                    Año escolar configurado
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatRange(form.firstSemesterStart, form.firstSemesterEnd)} ·{' '}
                    {formatRange(form.secondSemesterStart, form.secondSemesterEnd)}
                  </p>
                </div>

                {conflict && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                    <div className="flex items-center gap-2 font-semibold">
                      <TriangleAlert className="size-4" />
                      Asistencias fuera del período
                    </div>
                    <p className="mt-1 text-xs">{conflict.message}</p>
                    <p className="mt-2 text-xs font-medium">
                      Fechas detectadas: {conflict.conflictingDates.join(', ')}
                      {conflict.totalConflicts > conflict.conflictingDates.length
                        ? ` y ${conflict.totalConflicts - conflict.conflictingDates.length} más`
                        : ''}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-4" />
                    No se modifica ni elimina asistencia existente.
                  </div>
                  <button
                    type="submit"
                    disabled={!hasChanges || save.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="size-4" />
                    {save.isPending ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : (
        <BackupConfigPanel />
      )}
    </div>
  );
}

function SemesterFieldset({
  title,
  startId,
  endId,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
}: {
  title: string;
  startId: keyof FormState;
  endId: keyof FormState;
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={startId}>
          Inicio
          <input
            id={startId}
            type="date"
            value={startValue}
            onChange={(event) => onStartChange(event.target.value)}
            className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            required
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={endId}>
          Término
          <input
            id={endId}
            type="date"
            value={endValue}
            onChange={(event) => onEndChange(event.target.value)}
            className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            required
          />
        </label>
      </div>
    </fieldset>
  );
}

function formatRange(from: string, to: string): string {
  if (!from || !to) return 'Sin fechas';
  return `${formatDate(from)} a ${formatDate(to)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

function conflictFromError(
  error: unknown,
): { message: string; conflictingDates: string[]; totalConflicts: number } | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const data = error.data as {
    message?: unknown;
    conflictingDates?: unknown;
    totalConflicts?: unknown;
  };
  if (!data || !Array.isArray(data.conflictingDates)) return null;
  return {
    message:
      typeof data.message === 'string'
        ? data.message
        : 'La configuración dejaría asistencias fuera del año escolar.',
    conflictingDates: data.conflictingDates.filter(
      (date): date is string => typeof date === 'string',
    ),
    totalConflicts:
      typeof data.totalConflicts === 'number' ? data.totalConflicts : data.conflictingDates.length,
  };
}

type BackupConfig = {
  emails: string;
  time: string;
  hasPassword: boolean;
  passwordCompatible: boolean;
  passwordPlain: string | null;
  active: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'failed';
  lastError: string | null;
  running: boolean;
  lastMessageId: string | null;
  lastDeliveryMode: 'attachment' | 'download_link' | 'manual_download' | null;
  lastFileName: string | null;
  lastFileSizeBytes: number | null;
  lastDownloadExpiresAt: string | null;
  lastDownloadVerifiedAt: string | null;
  lastDownloadVerifiedStatus: string | null;
  latestDownloadAvailable: boolean;
  latestDownloadFileName: string | null;
  latestDownloadFileSizeBytes: number | null;
  latestDownloadExpiresAt: string | null;
};

type BackupHistoryItem = {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  encrypted: boolean;
};

function formatBackupTimestamp(value: string | null): string {
  if (!value) return 'Sin registro';
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return 'Sin registro';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function BackupConfigPanel() {
  const qc = useQueryClient();
  const [emails, setEmails] = useState('');
  const [time, setTime] = useState('23:00');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [active, setActive] = useState(true);

  const { data: config, isLoading } = useQuery<BackupConfig>({
    queryKey: ['system-backup-config'],
    queryFn: () => api.get('/system-config/backup'),
  });

  useEffect(() => {
    if (!config) return;
    setEmails(config.emails);
    setTime(config.time);
    setActive(config.active);
    setPassword(config.passwordPlain ?? '');
  }, [config]);

  const save = useMutation({
    mutationFn: (body: {
      emails: string;
      time: string;
      encryptPassword?: string;
      active: boolean;
    }) => api.put<BackupConfig>('/system-config/backup', body),
    onSuccess: (saved) => {
      toast.success('Configuración de backup guardada');
      void qc.setQueryData(['system-backup-config'], saved);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testBackup = useMutation({
    mutationFn: () => api.post('/system-config/backup/test', {}),
    onSuccess: () => {
      toast.success('Backup iniciado. Revisa el estado en este panel.');
      void qc.invalidateQueries({ queryKey: ['system-backup-config'] });
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.warning('Ya hay un backup en ejecución');
        void qc.invalidateQueries({ queryKey: ['system-backup-config'] });
        return;
      }
      toast.error(error.message);
    },
  });

  const downloadLatest = useMutation({
    mutationFn: () =>
      downloadBlob(
        '/system-config/backup/latest-download',
        config?.latestDownloadFileName ?? 'backup_asistencia.zip',
      ),
    onError: (error: Error) => toast.error(error.message),
  });

  const { data: history } = useQuery<BackupHistoryItem[]>({
    queryKey: ['system-backup-history'],
    queryFn: () => api.get('/system-config/backup/history'),
    refetchInterval: 60_000,
  });

  const downloadFromHistory = useMutation({
    mutationFn: (fileName: string) =>
      downloadBlob(`/system-config/backup/file?name=${encodeURIComponent(fileName)}`, fileName),
    onError: (error: Error) => toast.error(error.message),
  });

  const generateNow = useMutation({
    mutationFn: () =>
      downloadBlob('/system-config/backup/generate-download', 'backup_asistencia.zip', 'POST'),
    onSuccess: () => {
      toast.success('Respaldo generado y descargado');
      void qc.invalidateQueries({ queryKey: ['system-backup-config'] });
      void qc.invalidateQueries({ queryKey: ['system-backup-history'] });
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.warning('Ya hay un backup en ejecución');
        return;
      }
      toast.error(error.message);
    },
  });

  const [showTech, setShowTech] = useState(false);

  const copyKey = () => {
    if (!password) return;
    void navigator.clipboard
      .writeText(password)
      .then(() => toast.success('Contraseña copiada'))
      .catch(() => toast.error('No se pudo copiar'));
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-3 rounded-xl border border-border bg-background">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const hasChanges =
    !!config &&
    (emails !== config.emails ||
      time !== config.time ||
      password !== (config.passwordPlain ?? '') ||
      active !== config.active);
  const lastConfirmed = !!config?.lastMessageId && config.lastStatus === 'success';
  const backupVerified =
    lastConfirmed &&
    (config?.lastDeliveryMode === 'attachment' || config?.lastDownloadVerifiedStatus === '200');
  const passwordIncompatible = !!config?.hasPassword && !config.passwordCompatible;

  const passwordChanged = password !== (config?.passwordPlain ?? '');

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            emails,
            time,
            active,
            ...(passwordChanged && password.trim() !== '' ? { encryptPassword: password } : {}),
          });
        }}
        className="rounded-xl border border-border bg-background overflow-hidden"
      >
        <div className="border-b border-border px-5 py-4 flex items-center gap-3">
          <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
            <Database className="size-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Respaldo Automático de Base de Datos</h2>
            <p className="text-xs text-muted-foreground">
              Configure el envío por cambios de asistencia al horario definido.
            </p>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Habilitar */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 p-4">
            <div className="space-y-0.5">
              <label className="text-sm font-semibold cursor-pointer" htmlFor="backup-active">
                Habilitar Copias por Cambios de Asistencia
              </label>
              <p className="text-xs text-muted-foreground">
                Se enviará un respaldo completo diario a la hora configurada.
              </p>
            </div>
            <input
              id="backup-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-5 cursor-pointer rounded border-border accent-primary"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Correos */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="backup-emails">
                Correos de Destinatarios (separados por coma)
              </label>
              <input
                id="backup-emails"
                type="text"
                placeholder="ejemplo@correo.com, admin@correo.com"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50"
                required
                disabled={!active}
              />
              <p className="text-[10px] text-muted-foreground">
                El respaldo diario llegará a todos los correos configurados.
              </p>
            </div>

            {/* Hora */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="backup-time">
                Hora de Envío (Hora local de Chile)
              </label>
              <input
                id="backup-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50"
                required
                disabled={!active}
              />
              <p className="text-[10px] text-muted-foreground">
                A esta hora se enviará el respaldo completo de la base de datos.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Contraseña de cifrado (único campo: ver / editar / copiar) */}
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="backup-password"
              >
                Contraseña de cifrado del respaldo
              </label>
              <div className="relative">
                <input
                  id="backup-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Sin contraseña (no recomendado)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-border bg-background pl-3 pr-24 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50"
                  disabled={!active}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
                    disabled={!active}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={copyKey}
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition disabled:opacity-50"
                    disabled={!active || !password}
                    tabIndex={-1}
                  >
                    Copiar
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Con contraseña, el respaldo es un <strong>ZIP cifrado (AES-256)</strong> que abre
                con doble clic en Fedora/GNOME, Windows y macOS. La clave debe ser{' '}
                <strong>ASCII</strong> (letras, números y símbolos comunes; sin acentos ni ñ). No se
                envía por correo: guárdala en un lugar seguro.
              </p>
            </div>

            {/* Estado del último respaldo + acciones */}
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
              {config && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {config.running ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        <Loader2 className="size-3.5 animate-spin" /> Ejecutando…
                      </span>
                    ) : config.lastStatus === 'failed' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 dark:bg-red-500/15 dark:text-red-300">
                        <TriangleAlert className="size-3.5" /> Último respaldo falló
                      </span>
                    ) : config.lastStatus === 'success' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <CheckCircle2 className="size-3.5" /> Respaldo correcto
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Sin ejecución reciente
                      </span>
                    )}
                    {backupVerified && (
                      <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                        ✓ verificado
                      </span>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Último éxito</dt>
                      <dd className="font-medium text-foreground">
                        {formatBackupTimestamp(config.lastSuccessAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Tamaño</dt>
                      <dd className="font-medium text-foreground">
                        {formatBytes(config.lastFileSizeBytes)}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Entrega</dt>
                      <dd className="font-medium text-foreground">
                        {config.lastDeliveryMode === 'download_link'
                          ? 'Enlace temporal seguro'
                          : config.lastDeliveryMode === 'attachment'
                            ? 'Adjunto en el correo'
                            : config.lastDeliveryMode === 'manual_download'
                              ? 'Descarga directa'
                              : 'Sin registro'}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Archivo</dt>
                      <dd className="font-medium text-foreground break-all">
                        {config.lastFileName ?? 'Sin registro'}
                      </dd>
                    </div>
                  </dl>

                  {config.lastError && (
                    <p className="rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200 break-words">
                      {config.lastError}
                    </p>
                  )}

                  {passwordIncompatible && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                      Tu contraseña tiene acentos/ñ, que el ZIP cifrado no admite. El sistema generó
                      una clave ASCII automática (visible arriba); cámbiala por una propia solo con
                      letras y números si quieres.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowTech((v) => !v)}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showTech ? 'Ocultar detalles técnicos' : 'Ver detalles técnicos'}
                  </button>
                  {showTech && (
                    <dl className="space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                      <div>
                        <dt className="inline font-medium text-foreground">Último intento:</dt>{' '}
                        {formatBackupTimestamp(config.lastAttemptAt)}
                      </div>
                      {config.latestDownloadExpiresAt && (
                        <div>
                          <dt className="inline font-medium text-foreground">Descarga expira:</dt>{' '}
                          {formatBackupTimestamp(config.latestDownloadExpiresAt)}
                        </div>
                      )}
                      {config.lastDeliveryMode === 'download_link' &&
                        config.lastDownloadVerifiedAt && (
                          <div>
                            <dt className="inline font-medium text-foreground">Enlace público:</dt>{' '}
                            {config.lastDownloadVerifiedStatus === '200'
                              ? 'Verificado (200)'
                              : `Verificación ${config.lastDownloadVerifiedStatus ?? 'sin estado'}`}
                          </div>
                        )}
                      {config.lastMessageId && (
                        <div className="break-all">
                          <dt className="inline font-medium text-foreground">Brevo messageId:</dt>{' '}
                          {config.lastMessageId}
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              )}

              {hasChanges && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  Guarda la configuración antes de generar o probar.
                </p>
              )}

              <div className="mt-auto space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (hasChanges) {
                      toast.warning('Guarda la configuración primero');
                      return;
                    }
                    generateNow.mutate();
                  }}
                  disabled={
                    generateNow.isPending ||
                    save.isPending ||
                    !active ||
                    config?.running ||
                    hasChanges
                  }
                  className="w-full inline-flex justify-center items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {generateNow.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Generando…
                    </>
                  ) : (
                    <>
                      <Download className="size-4" /> Generar y descargar ahora
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (hasChanges) {
                      toast.warning('Guarda la configuración antes de probar el envío');
                      return;
                    }
                    testBackup.mutate();
                  }}
                  disabled={
                    testBackup.isPending ||
                    save.isPending ||
                    !active ||
                    config?.running ||
                    hasChanges
                  }
                  className="w-full inline-flex justify-center items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {testBackup.isPending || config?.running
                    ? 'Backup en ejecución…'
                    : 'Probar envío por correo'}
                </button>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  <strong>Generar y descargar</strong> crea un respaldo nuevo y lo baja al instante
                  (sin correo). <strong>Probar envío</strong> además lo manda a los correos
                  configurados.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 bg-muted/5">
          <div className="text-xs text-muted-foreground">
            Los cambios se aplicarán en la próxima revisión automática.
          </div>
          <button
            type="submit"
            disabled={!hasChanges || save.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="size-4" />
            {save.isPending ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
              <Download className="size-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Historial de respaldos</h2>
              <p className="text-xs text-muted-foreground">
                Respaldos disponibles en el servidor (base de datos + archivos).
              </p>
            </div>
          </div>
          {config?.latestDownloadAvailable && (
            <button
              type="button"
              onClick={() => downloadLatest.mutate()}
              disabled={downloadLatest.isPending || config.running}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Download className="size-4" />
              {downloadLatest.isPending ? 'Descargando...' : 'Descargar último'}
            </button>
          )}
        </div>
        <div className="p-2">
          {!history || history.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Aún no hay respaldos generados. Usa “Probar Envío Ahora” para crear el primero.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((item) => (
                <li
                  key={item.fileName}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{item.fileName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatBackupTimestamp(item.createdAt.slice(0, 19).replace('T', ' '))} ·{' '}
                      {formatBytes(item.sizeBytes)} · {item.encrypted ? 'Cifrado' : 'Sin cifrar'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadFromHistory.mutate(item.fileName)}
                    disabled={downloadFromHistory.isPending}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <Download className="size-3.5" />
                    Descargar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
