import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuthStore } from '@/stores/auth.store';
import { api, ApiError } from '@/lib/api';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    const { accessToken, user } = useAuthStore.getState();
    if (accessToken && user) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

type Step = 'credentials' | 'totp_setup' | 'totp_verify';
type SetupData = { qrCodeDataUrl: string; backupCodes: string[] };

function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const setTokens = useAuthStore((s) => s.setTokens);
  const isLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [rememberDevice, setRememberDevice] = useState(false);
  const storedDeviceToken = localStorage.getItem('cssp_device_token') ?? undefined;

  const busy = isLoading || isFetching;

  const showError = (msg: string, data?: unknown) => {
    setErrorMsg(msg);
    setShakeKey((k) => k + 1);
    const rem = (data as { remainingAttempts?: number } | undefined)?.remainingAttempts;
    if (rem != null) setRemainingAttempts(rem);
    toast.error(msg);
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const result = await login(email, password, undefined, storedDeviceToken);

      if (result.requiresTotpSetup) {
        setSetupToken(result.setupToken);
        setIsFetching(true);
        try {
          const data = await api.post<SetupData>('/auth/2fa/setup', {}, result.setupToken);
          setSetupData(data);
          setStep('totp_setup');
          toast.info('Configura tu app autenticadora');
        } catch {
          showError('Error al iniciar configuración 2FA');
        } finally {
          setIsFetching(false);
        }
        return;
      }

      if (result.requiresTotp) {
        setStep('totp_verify');
        toast.info('Ingresa tu código del autenticador');
        return;
      }

      if (!result.requiresTotp && !result.requiresTotpSetup && result.deviceToken) {
        localStorage.setItem('cssp_device_token', result.deviceToken);
      }
      void navigate({ to: '/' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error de conexión';
      showError(
        Array.isArray(msg) ? msg.join(', ') : msg,
        err instanceof ApiError ? err.data : undefined,
      );
    }
  };

  const handleTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupToken) return;
    setErrorMsg(null);
    setIsFetching(true);
    try {
      const data = await api.post<{
        success: boolean;
        accessToken?: string;
        refreshToken?: string;
        message?: string;
      }>('/auth/2fa/verify', { code: totpCode }, setupToken);
      if (!data.success) {
        showError(data.message ?? 'Código inválido');
        return;
      }
      if (data.accessToken && data.refreshToken) {
        setTokens(data.accessToken, data.refreshToken);
        toast.success('Autenticador configurado correctamente');
        void navigate({ to: '/' });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error de verificación';
      showError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setIsFetching(false);
    }
  };

  const handleTotpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const result = await login(email, password, totpCode, undefined, rememberDevice);
      if (!result.requiresTotp && !result.requiresTotpSetup) {
        if (result.deviceToken) {
          localStorage.setItem('cssp_device_token', result.deviceToken);
        }
        void navigate({ to: '/' });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Código inválido';
      showError(Array.isArray(msg) ? msg.join(', ') : msg);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background text-foreground">
      {/* Hero brand panel */}
      <aside
        className="hidden lg:flex relative flex-col justify-between p-12 text-white overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #008269 0%, #004d40 100%)' }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 60%, white 1px, transparent 1px)',
            backgroundSize: '48px 48px, 64px 64px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <img src="/logo-cssp.png" alt="CSSP" className="size-14 object-contain drop-shadow-lg" />
          <div>
            <p className="text-sm font-semibold tracking-wide opacity-90">CSSP · 2026</p>
            <p className="text-xs opacity-70">Colegio San Sebastián de Paine</p>
          </div>
        </div>

        <div className="relative space-y-6 max-w-md">
          <h2 className="text-4xl font-bold leading-tight">
            Asistencia institucional, <span className="text-emerald-200">simplificada</span>.
          </h2>
          <p className="text-base opacity-90 leading-relaxed">
            Plataforma profesional para gestión de asistencia, justificaciones y comunicación con
            apoderados. Diseñada para directivos, docentes y familias.
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <ShieldCheck className="size-5 mt-0.5 text-emerald-200 shrink-0" />
              <span>Seguridad nivel institucional con 2FA obligatorio para personal.</span>
            </li>
            <li className="flex items-start gap-3">
              <Sparkles className="size-5 mt-0.5 text-emerald-200 shrink-0" />
              <span>Reportes automáticos, alertas tempranas y notificaciones a apoderados.</span>
            </li>
          </ul>
        </div>

        <p className="relative text-xs opacity-70">
          © {new Date().getFullYear()} Colegio San Sebastián de Paine
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex flex-col items-center mb-6 gap-2">
            <img
              src="/logo-cssp.png"
              alt="CSSP"
              className="size-16 object-contain drop-shadow-md"
            />
            <h1 className="text-lg font-bold">Asistencia CSSP</h1>
          </div>

          <div className="bg-background border border-border rounded-2xl shadow-sm overflow-hidden">
            {step === 'credentials' && (
              <form
                key={shakeKey}
                onSubmit={(e) => void handleCredentials(e)}
                className={`p-7 space-y-5${shakeKey > 0 ? ' animate-shake' : ''}`}
              >
                <header>
                  <h2 className="text-2xl font-bold tracking-tight">Iniciar sesión</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Ingresa con tus credenciales institucionales.
                  </p>
                </header>

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {errorMsg}
                  </div>
                )}

                {remainingAttempts != null && remainingAttempts <= 3 && remainingAttempts > 0 && (
                  <div className="rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>
                      Tu cuenta se bloqueará después de {remainingAttempts} intento
                      {remainingAttempts !== 1 ? 's' : ''} más.
                    </span>
                  </div>
                )}
                {remainingAttempts === 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
                    <LockKeyhole className="size-4 shrink-0" />
                    <span>Cuenta bloqueada. Espera 30 minutos o contacta al administrador.</span>
                  </div>
                )}

                <div className="space-y-4">
                  <Field label="Correo electrónico" htmlFor="email">
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={busy}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nombre@cssp.cl"
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Contraseña" htmlFor="password">
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        disabled={busy}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={inputCls + ' pr-10'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition"
                        tabIndex={-1}
                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </Field>
                </div>

                <button type="submit" disabled={busy} className={primaryBtn}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy ? 'Verificando…' : 'Ingresar'}
                </button>

                <p className="text-center text-xs text-muted-foreground">
                  ¿Cuenta bloqueada? Contacta a tu administrador del colegio.
                </p>
              </form>
            )}

            {step === 'totp_setup' && setupData && (
              <form onSubmit={(e) => void handleTotpSetup(e)} className="p-7 space-y-5">
                <header>
                  <h2 className="text-2xl font-bold tracking-tight">Configura tu autenticador</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Escanea el código QR con Google Authenticator, Authy o 1Password.
                  </p>
                </header>

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {errorMsg}
                  </div>
                )}

                <div className="flex justify-center">
                  <img
                    src={setupData.qrCodeDataUrl}
                    alt="QR code para autenticador"
                    className="size-48 rounded-xl border border-border bg-white p-2"
                  />
                </div>

                <Field label="Código de verificación (6 dígitos)" htmlFor="totp-setup">
                  <input
                    id="totp-setup"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    autoFocus
                    autoComplete="one-time-code"
                    required
                    disabled={busy}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className={inputCls + ' text-center tracking-[0.5em] font-mono'}
                  />
                </Field>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowBackupCodes((v) => !v)}
                    className="text-xs font-medium text-primary hover:underline underline-offset-4"
                  >
                    {showBackupCodes ? 'Ocultar' : 'Mostrar'} códigos de respaldo
                  </button>
                  {showBackupCodes && (
                    <div className="mt-2 p-3 bg-warning/10 border border-warning/30 rounded-lg">
                      <p className="text-xs font-medium text-warning mb-2">
                        Guarda estos códigos en un lugar seguro. Úsalos si pierdes el autenticador.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {setupData.backupCodes.map((code) => (
                          <code
                            key={code}
                            className="text-xs font-mono bg-background px-2 py-1 rounded border border-border text-center"
                          >
                            {code}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={busy || totpCode.length !== 6}
                  className={primaryBtn}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy ? 'Verificando…' : 'Activar y continuar'}
                </button>
              </form>
            )}

            {step === 'totp_verify' && (
              <form onSubmit={(e) => void handleTotpVerify(e)} className="p-7 space-y-5">
                <header>
                  <h2 className="text-2xl font-bold tracking-tight">Verificación en dos pasos</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Ingresa el código de 6 dígitos de tu app autenticadora.
                  </p>
                </header>

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {errorMsg}
                  </div>
                )}

                <Field label="Código autenticador" htmlFor="totp-verify">
                  <input
                    id="totp-verify"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    autoFocus
                    autoComplete="one-time-code"
                    required
                    disabled={busy}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className={inputCls + ' text-center tracking-[0.5em] font-mono'}
                  />
                </Field>

                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="rounded border-border"
                  />
                  Recordar este dispositivo por 1 semana
                </label>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('credentials');
                      setTotpCode('');
                      setErrorMsg(null);
                    }}
                    className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition"
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    disabled={busy || totpCode.length !== 6}
                    className={primaryBtn + ' flex-1'}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    {busy ? 'Verificando…' : 'Verificar'}
                  </button>
                </div>
              </form>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6 lg:hidden">
            © {new Date().getFullYear()} Colegio San Sebastián de Paine
          </p>
        </div>
      </main>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition disabled:opacity-50';

const primaryBtn =
  'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] disabled:opacity-50 disabled:cursor-not-allowed';

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
