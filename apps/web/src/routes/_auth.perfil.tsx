import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Shield,
  ShieldCheck,
  Trash2,
  UserCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { toast } from 'sonner';

import { api, fetchBlob, uploadFormData } from '@/lib/api';
import { cn } from '@/lib/cn';

export const Route = createFileRoute('/_auth/perfil')({
  component: ProfilePage,
});

type Profile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  avatarUpdatedAt?: string | null;
  hasAvatar: boolean;
  schoolRoles: { schoolId: string; role: string }[];
  twoFactorEnabled: boolean;
};

type TotpSetup = {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  DIRECTOR: 'Director',
  UTP: 'UTP',
  INSPECTORIA: 'Inspectoría',
  PROFESOR: 'Profesor/a',
  APODERADO: 'Apoderado/a',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function initials(profile?: Profile): string {
  if (!profile) return 'U';
  const raw = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.trim();
  return raw ? raw.toUpperCase() : (profile.email[0]?.toUpperCase() ?? 'U');
}

export function ProfilePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const { data: profile, isLoading } = useQuery<Profile>({
    queryKey: ['me'],
    queryFn: () => api.get('/users/me'),
  });

  useEffect(() => {
    let objectUrl: string | null = null;
    if (!profile?.hasAvatar) {
      setAvatarUrl(null);
      return undefined;
    }
    fetchBlob(`/users/me/avatar?ts=${profile.avatarUpdatedAt ?? ''}`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => setAvatarUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profile?.hasAvatar, profile?.avatarUpdatedAt]);

  const uploadAvatar = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return uploadFormData('/users/me/avatar', form);
    },
    onSuccess: () => {
      toast.success('Imagen de perfil actualizada');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAvatar = useMutation({
    mutationFn: () => api.del('/users/me/avatar'),
    onSuccess: () => {
      toast.success('Imagen eliminada');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roles = profile?.schoolRoles.map((r) => ROLE_LABELS[r.role] ?? r.role) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-full bg-primary/15 text-primary ring-1 ring-border">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-xl font-semibold">
                {initials(profile)}
              </div>
            )}
            {uploadAvatar.isPending && (
              <div className="absolute inset-0 grid place-items-center bg-background/70">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight">
              {isLoading ? 'Perfil' : `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`}
            </h1>
            <p className="truncate text-sm text-muted-foreground">{profile?.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {roles.map((role) => (
                <span key={role} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                toast.error('La imagen supera 2 MB.');
                return;
              }
              uploadAvatar.mutate(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Camera className="size-4" />
            Cambiar foto
          </button>
          {profile?.hasAvatar && (
            <button
              type="button"
              onClick={() => removeAvatar.mutate()}
              disabled={removeAvatar.isPending}
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="size-4" />
              Quitar
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)]">
        <section className="space-y-6">
          <ProfileDetails profile={profile} />
          <PasswordCard />
        </section>
        <SecurityCard profile={profile} />
      </div>
    </div>
  );
}

function ProfileDetails({ profile }: { profile: Profile | undefined }) {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    setFirstName(profile?.firstName ?? '');
    setLastName(profile?.lastName ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile]);

  const update = useMutation({
    mutationFn: () => api.patch('/users/me', { firstName, lastName, phone }),
    onSuccess: () => {
      toast.success('Perfil actualizado');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <div className="mb-4 flex items-center gap-2">
        <UserCircle className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Datos de cuenta</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Nombre</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Apellido</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Teléfono</span>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+56912345678"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
        </label>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <InfoRow icon={Mail} label="Correo" value={profile?.email ?? 'Cargando'} />
        <InfoRow
          icon={CheckCircle2}
          label="Estado"
          value={profile?.status === 'ACTIVE' ? 'Activo' : (profile?.status ?? 'Cargando')}
        />
        <InfoRow icon={Shield} label="Creado" value={formatDateTime(profile?.createdAt)} />
        <InfoRow
          icon={ShieldCheck}
          label="Último acceso"
          value={formatDateTime(profile?.lastLoginAt)}
        />
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => update.mutate()}
          disabled={!firstName || !lastName || update.isPending}
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {update.isPending ? 'Guardando...' : 'Guardar datos'}
        </button>
      </div>
    </section>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  const requirements = useMemo(
    () => [
      { label: '12 caracteres o más', ok: newPassword.length >= 12 },
      {
        label: 'Mayúscula y minúscula',
        ok: /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword),
      },
      { label: 'Número o símbolo', ok: /[\d\W_]/.test(newPassword) },
      {
        label: 'Coincide con la confirmación',
        ok: newPassword.length > 0 && newPassword === confirmPassword,
      },
    ],
    [newPassword, confirmPassword],
  );
  const ready = currentPassword && requirements.every((r) => r.ok);

  const change = useMutation({
    mutationFn: () => api.post('/users/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setVisible({});
      toast.success('Contraseña actualizada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <div className="mb-4 flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Contraseña</h2>
      </div>
      <div className="space-y-3">
        <PasswordInput
          label="Contraseña actual"
          value={currentPassword}
          visible={visible.current === true}
          onChange={setCurrentPassword}
          onToggle={() => setVisible((v) => ({ ...v, current: !v.current }))}
          autoComplete="current-password"
        />
        <PasswordInput
          label="Nueva contraseña"
          value={newPassword}
          visible={visible.next === true}
          onChange={setNewPassword}
          onToggle={() => setVisible((v) => ({ ...v, next: !v.next }))}
          autoComplete="new-password"
        />
        <PasswordInput
          label="Repetir nueva contraseña"
          value={confirmPassword}
          visible={visible.confirm === true}
          onChange={setConfirmPassword}
          onToggle={() => setVisible((v) => ({ ...v, confirm: !v.confirm }))}
          autoComplete="new-password"
        />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {requirements.map((req) => (
          <div
            key={req.label}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
              req.ok
                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Check className="size-3.5" />
            {req.label}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => change.mutate()}
        disabled={!ready || change.isPending}
        className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {change.isPending ? 'Actualizando...' : 'Actualizar contraseña'}
      </button>
    </section>
  );
}

function SecurityCard({ profile }: { profile: Profile | undefined }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenCode, setRegenCode] = useState('');
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  const { data: status } = useQuery<{ enabled: boolean; backupCodesRemaining: number }>({
    queryKey: ['2fa-status'],
    queryFn: () => api.get('/auth/2fa/status'),
  });

  const enabled = status?.enabled ?? profile?.twoFactorEnabled ?? false;

  const startSetup = useMutation({
    mutationFn: () => api.post<TotpSetup>('/auth/2fa/setup', {}),
    onSuccess: (data) => {
      setSetup(data);
      setVerifyCode('');
      setNewBackupCodes(data.backupCodes);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; message?: string }>('/auth/2fa/verify', { code: verifyCode }),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.message ?? 'Código inválido');
        return;
      }
      toast.success('2FA activado');
      setSetup(null);
      setVerifyCode('');
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disable = useMutation({
    mutationFn: () => api.delWithBody('/auth/2fa', { code: disableCode }),
    onSuccess: () => {
      toast.success('2FA desactivado');
      setDisableCode('');
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerate = useMutation({
    mutationFn: () =>
      api.post<{ backupCodes: string[] }>('/auth/2fa/backup-codes', { code: regenCode }),
    onSuccess: (data) => {
      setNewBackupCodes(data.backupCodes);
      setRegenCode('');
      toast.success('Códigos de respaldo regenerados');
      void qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <aside className="rounded-lg border border-border bg-background p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Seguridad 2FA</h2>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-semibold',
            enabled
              ? 'bg-green-500/10 text-green-700 dark:text-green-400'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
          )}
        >
          {enabled ? 'Activado' : 'Sin activar'}
        </span>
      </div>

      {!enabled && !setup && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Usa Google Authenticator, Microsoft Authenticator, 1Password o una app compatible.
          </p>
          <button
            type="button"
            onClick={() => startSetup.mutate()}
            disabled={startSetup.isPending}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {startSetup.isPending ? 'Preparando...' : 'Activar autenticador'}
          </button>
        </div>
      )}

      {setup && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-3">
            <img
              src={setup.qrCodeDataUrl}
              alt="QR para configurar autenticador"
              className="mx-auto size-56"
            />
          </div>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Código de 6 dígitos</span>
            <input
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-lg font-semibold tracking-[0.3em]"
            />
          </label>
          <button
            type="button"
            onClick={() => verify.mutate()}
            disabled={verifyCode.length !== 6 || verify.isPending}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Confirmar y activar
          </button>
          <BackupCodes codes={setup.backupCodes} />
        </div>
      )}

      {enabled && (
        <div className="space-y-5">
          <InfoRow
            icon={ShieldCheck}
            label="Códigos de respaldo disponibles"
            value={String(status?.backupCodesRemaining ?? 0)}
          />
          <div className="space-y-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Código 2FA para regenerar respaldo
              </span>
              <input
                value={regenCode}
                onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => regenerate.mutate()}
              disabled={regenCode.length !== 6 || regenerate.isPending}
              className="inline-flex min-h-[40px] w-full items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              Regenerar códigos de respaldo
            </button>
          </div>
          {newBackupCodes && <BackupCodes codes={newBackupCodes} />}
          <div className="border-t border-border pt-4">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Código 2FA para desactivar
              </span>
              <input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => disable.mutate()}
              disabled={disableCode.length !== 6 || disable.isPending}
              className="mt-2 inline-flex min-h-[40px] w-full items-center justify-center rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Desactivar 2FA
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function PasswordInput({
  label,
  value,
  visible,
  onChange,
  onToggle,
  autoComplete,
}: {
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  autoComplete: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-border bg-background py-2 pl-3 pr-11 text-sm"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </label>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
          Códigos de respaldo
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              toast.success('Códigos copiados');
            }}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Copiar códigos"
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = 'codigos-respaldo-2fa.txt';
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Descargar códigos"
          >
            <Download className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {codes.map((code) => (
          <code
            key={code}
            className="rounded-md bg-background px-2 py-1 text-center text-xs font-semibold"
          >
            {code}
          </code>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Guárdalos fuera del sistema. Cada código sirve una sola vez si pierdes el autenticador.
      </p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
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
