import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
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
  active: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'failed';
  lastError: string | null;
  running: boolean;
  lastMessageId: string | null;
  lastDeliveryMode: 'attachment' | 'download_link' | null;
  lastFileName: string | null;
  lastFileSizeBytes: number | null;
  lastDownloadExpiresAt: string | null;
  latestDownloadAvailable: boolean;
  latestDownloadFileName: string | null;
  latestDownloadFileSizeBytes: number | null;
  latestDownloadExpiresAt: string | null;
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
      setPassword('');
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
        config?.latestDownloadFileName ?? 'backup_asistencia.sql.zip',
      ),
    onError: (error: Error) => toast.error(error.message),
  });

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
      password !== '' ||
      active !== config.active);
  const lastConfirmed = !!config?.lastMessageId && config.lastStatus === 'success';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          emails,
          time,
          active,
          ...(password.trim() !== '' ? { encryptPassword: password } : {}),
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
          {/* Contraseña ZIP */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="backup-password">
              Contraseña de Cifrado del archivo de respaldo (Recomendado)
            </label>
            <div className="relative">
              <input
                id="backup-password"
                type={showPassword ? 'text' : 'password'}
                placeholder={
                  config?.hasPassword
                    ? '•••••••• (Establecida - escribe para cambiarla)'
                    : 'Sin contraseña de encriptación (No recomendado)'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-border bg-background pl-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50"
                disabled={!active}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
                disabled={!active}
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-amber-600 dark:text-amber-400">
              Cifra el archivo adjunto con AES-256. La clave no se envía por correo.
            </p>
          </div>

          {/* Información y Test */}
          <div className="rounded-lg border border-border bg-muted/20 p-4 flex flex-col justify-between">
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Seguridad e Integridad:</span>
              <p className="mt-1">
                La prueba fuerza un respaldo y valida que el servidor pueda enviar los correos.
              </p>
              {hasChanges && (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  Guarda la configuración antes de probar el envío.
                </p>
              )}
              {config && (
                <div className="mt-3 space-y-1 rounded-lg border border-border bg-background/70 p-3">
                  <p>
                    <span className="font-medium text-foreground">Estado:</span>{' '}
                    {config.running
                      ? 'Ejecutando'
                      : lastConfirmed
                        ? 'Enviado correctamente'
                        : config.lastStatus === 'success'
                          ? 'Terminado sin confirmación de correo'
                          : config.lastStatus === 'failed'
                            ? 'Último respaldo falló'
                            : 'Sin ejecución reciente'}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Último intento:</span>{' '}
                    {formatBackupTimestamp(config.lastAttemptAt)}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Último éxito:</span>{' '}
                    {formatBackupTimestamp(config.lastSuccessAt)}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Entrega:</span>{' '}
                    {config.lastDeliveryMode === 'download_link'
                      ? 'Link temporal seguro'
                      : config.lastDeliveryMode === 'attachment'
                        ? 'Adjunto'
                        : 'Sin registro'}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Archivo:</span>{' '}
                    {config.lastFileName ?? 'Sin registro'}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Tamaño:</span>{' '}
                    {formatBytes(config.lastFileSizeBytes)}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Descarga completa:</span>{' '}
                    {config.latestDownloadAvailable
                      ? `${config.latestDownloadFileName ?? 'Disponible'} (${formatBytes(
                          config.latestDownloadFileSizeBytes,
                        )})`
                      : 'No disponible'}
                  </p>
                  {config.latestDownloadExpiresAt && (
                    <p>
                      <span className="font-medium text-foreground">Descarga expira:</span>{' '}
                      {formatBackupTimestamp(config.latestDownloadExpiresAt)}
                    </p>
                  )}
                  {config.lastDownloadExpiresAt && (
                    <p>
                      <span className="font-medium text-foreground">Link expira:</span>{' '}
                      {formatBackupTimestamp(config.lastDownloadExpiresAt)}
                    </p>
                  )}
                  {config.lastMessageId && (
                    <p>
                      <span className="font-medium text-foreground">Brevo messageId:</span>{' '}
                      {config.lastMessageId}
                    </p>
                  )}
                  {config.lastError && (
                    <p className="text-red-600 dark:text-red-400">
                      <span className="font-medium">Error:</span> {config.lastError}
                    </p>
                  )}
                </div>
              )}
            </div>
            {config?.latestDownloadAvailable && (
              <button
                type="button"
                onClick={() => downloadLatest.mutate()}
                disabled={downloadLatest.isPending || config.running}
                className="mt-3 w-full inline-flex justify-center items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                <Download className="size-4" />
                {downloadLatest.isPending ? 'Descargando...' : 'Descargar último backup completo'}
              </button>
            )}
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
                testBackup.isPending || save.isPending || !active || config?.running || hasChanges
              }
              className="mt-3 w-full inline-flex justify-center items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              {testBackup.isPending || config?.running
                ? 'Backup en ejecución...'
                : 'Probar Envío Ahora (Test)'}
            </button>
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
  );
}
