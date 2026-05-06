import { Download, RefreshCw, Share, Smartphone, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const INSTALL_DISMISSED_KEY = 'pwa-install-dismissed-at';
const INSTALL_DISMISS_DAYS = 14;

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function PwaLifecycle() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  const platform = useMemo(getPlatform, []);
  const standalone = useMemo(isStandalone, []);

  useEffect(() => {
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        setShowUpdate(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
        window.setTimeout(() => setOfflineReady(false), 6000);
      },
    });

    const checkForUpdates = () => {
      if (document.visibilityState === 'visible') {
        void navigator.serviceWorker
          ?.getRegistration()
          .then((registration) => registration?.update());
      }
    };
    const interval = window.setInterval(checkForUpdates, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', checkForUpdates);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkForUpdates);
    };
  }, []);

  useEffect(() => {
    if (standalone) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      if (!recentlyDismissed()) setShowInstall(true);
    };
    const onAppInstalled = () => {
      setShowInstall(false);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    const timer = window.setTimeout(() => {
      if (!recentlyDismissed() && (platform.isIOS || platform.isMobile)) setShowInstall(true);
    }, 1800);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.clearTimeout(timer);
    };
  }, [platform.isIOS, platform.isMobile, standalone]);

  const dismissInstall = () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
    setShowInstall(false);
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'dismissed') dismissInstall();
    else setShowInstall(false);
  };

  return (
    <>
      {showInstall && !standalone && (
        <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-lg border border-border bg-background p-4 shadow-2xl sm:bottom-5">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Smartphone className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Instalar Asistencia</p>
              <InstallHelp platform={platform} canPrompt={!!installPrompt} />
              <div className="mt-3 flex flex-wrap gap-2">
                {installPrompt ? (
                  <button
                    type="button"
                    onClick={() => void install()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                  >
                    <Download className="size-3.5" />
                    Instalar app
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={dismissInstall}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                >
                  Después
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissInstall}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {showUpdate && (
        <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-md rounded-lg border border-border bg-background p-4 shadow-2xl sm:bottom-5">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <RefreshCw className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Nueva versión disponible</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Actualiza para ver los últimos cambios sin hacer hard refresh.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void updateServiceWorker?.(true)}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Actualizar ahora
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpdate(false)}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                >
                  Luego
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {offlineReady && (
        <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium shadow-xl">
          Lista para uso sin conexión.
        </div>
      )}
    </>
  );
}

function InstallHelp({
  platform,
  canPrompt,
}: {
  platform: ReturnType<typeof getPlatform>;
  canPrompt: boolean;
}) {
  if (canPrompt) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Tendrás acceso desde la pantalla de inicio y carga más rápida en móvil.
      </p>
    );
  }

  if (platform.isIOS) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        En iPhone/iPad abre Safari, toca <Share className="inline size-3.5" /> Compartir y elige
        "Agregar a pantalla de inicio".
      </p>
    );
  }

  if (platform.isAndroid) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        En Android usa Chrome/Edge y abre el menú del navegador para elegir "Instalar app" o
        "Agregar a pantalla principal".
      </p>
    );
  }

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      En navegadores compatibles aparecerá la opción de instalación en la barra de direcciones.
    </p>
  );
}

function getPlatform() {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || /Mobile/i.test(ua);
  return { isIOS, isAndroid, isMobile };
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean(navigator.standalone))
  );
}

function recentlyDismissed() {
  const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISSED_KEY) ?? 0);
  if (!dismissedAt) return false;
  return Date.now() - dismissedAt < INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
}
