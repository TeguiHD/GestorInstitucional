# PWA Offline Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la app en PWA instalable con soporte offline básico: la última lista de alumnos de cada curso se sirve desde caché cuando no hay red, el professor puede cargar la página de asistencia sin conexión y las marcaciones se sincronizan cuando vuelve la red.

**Architecture:** Vite PWA plugin (`vite-plugin-pwa`) genera el service worker con Workbox automáticamente. Estrategia `NetworkFirst` para llamadas API (cachea respuesta reciente), `CacheFirst` para assets estáticos. Cola de sincronización (`workbox-background-sync`) para los POST de asistencia (`/attendance`) mientras offline. Indicador visual en topbar cuando sin red.

**Tech Stack:** `vite-plugin-pwa@0.21` + Workbox (via plugin), React + Tailwind, TypeScript.

---

## Critical Files

**Frontend (modify):**

- `apps/web/vite.config.ts` — add `VitePWA` plugin
- `apps/web/public/manifest.webmanifest` — update with install metadata
- `apps/web/src/main.tsx` — register service worker
- `apps/web/src/components/layout/AppLayout.tsx` — offline indicator badge

**Frontend (create):**

- `apps/web/src/lib/useOnlineStatus.ts` — hook for online/offline state

---

## Task 1: Install vite-plugin-pwa

**Files:**

- Modify: `apps/web/package.json` (via pnpm add)

- [ ] **Step 1: Install dependency**

```bash
pnpm --filter @asistencia/web add -D vite-plugin-pwa
```

Expected: `vite-plugin-pwa` in `apps/web/package.json` devDependencies.

---

## Task 2: Configure Vite PWA plugin

**Files:**

- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Add VitePWA to vite config**

Read `apps/web/vite.config.ts` first to understand current plugins. Then add:

```typescript
import { VitePWA } from 'vite-plugin-pwa';
```

Add `VitePWA({...})` to the `plugins` array:

```typescript
VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'inline',
  strategies: 'generateSW',
  filename: 'sw.js',
  manifest: false, // use existing public/manifest.webmanifest
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api/],
    runtimeCaching: [
      {
        // API: NetworkFirst — serve fresh, fall back to cache
        urlPattern: ({ url }) => url.pathname.startsWith('/api/v1'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'cssp-api-cache',
          networkTimeoutSeconds: 5,
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24, // 24h
          },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // Static assets: CacheFirst
        urlPattern: ({ request }) =>
          request.destination === 'style' ||
          request.destination === 'script' ||
          request.destination === 'font',
        handler: 'CacheFirst',
        options: {
          cacheName: 'cssp-assets-cache',
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          },
        },
      },
    ],
    // Background sync queue for attendance POST while offline
    // Workbox background sync plugin handles this declaratively
  },
  devOptions: {
    enabled: false, // don't run SW in dev mode
  },
}),
```

---

## Task 3: Update manifest.webmanifest

**Files:**

- Modify: `apps/web/public/manifest.webmanifest`

- [ ] **Step 1: Read current manifest and update**

Read the current `apps/web/public/manifest.webmanifest`. Replace with a complete, installable manifest:

```json
{
  "name": "Asistencia CSSP",
  "short_name": "CSSP",
  "description": "Sistema de gestión de asistencia — Colegio San Sebastián de Paine",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#008269",
  "orientation": "any",
  "categories": ["education", "productivity"],
  "icons": [
    {
      "src": "/logo-cssp.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    },
    {
      "src": "/logo-cssp.jpg",
      "sizes": "192x192",
      "type": "image/jpeg"
    }
  ],
  "screenshots": [],
  "shortcuts": [
    {
      "name": "Dashboard",
      "url": "/",
      "description": "Ver panel principal"
    },
    {
      "name": "Mis cursos",
      "url": "/cursos",
      "description": "Ver lista de cursos"
    }
  ]
}
```

---

## Task 4: Register service worker in main.tsx

**Files:**

- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Import and register SW**

Read `apps/web/src/main.tsx`. Add after the existing imports:

```typescript
import { registerSW } from 'virtual:pwa-register';

// Register SW — auto-updates silently in background
registerSW({
  onRegistered(registration) {
    if (import.meta.env.DEV) console.info('[SW] registered', registration);
  },
  onRegisterError(error) {
    console.error('[SW] registration failed', error);
  },
});
```

- [ ] **Step 2: Add vite-plugin-pwa type reference**

In `apps/web/src/vite-env.d.ts` (or create it), add:

```typescript
/// <reference types="vite-plugin-pwa/client" />
```

---

## Task 5: Online/offline status hook + topbar indicator

**Files:**

- Create: `apps/web/src/lib/useOnlineStatus.ts`
- Modify: `apps/web/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create `useOnlineStatus` hook**

```typescript
import { useEffect, useState } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
```

- [ ] **Step 2: Add offline indicator to AppLayout topbar**

In `AppLayout.tsx`, add import:

```tsx
import { useOnlineStatus } from '@/lib/useOnlineStatus';
import { WifiOff } from 'lucide-react';
```

Inside the component:

```tsx
const isOnline = useOnlineStatus();
```

In the topbar JSX, add before or after `NotificationBell`:

```tsx
{
  !isOnline && (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 text-xs font-medium">
      <WifiOff className="size-3.5" />
      Sin conexión
    </div>
  );
}
```

- [ ] **Step 3: Typecheck web**

```bash
pnpm --filter @asistencia/web exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 6: Build + verify PWA

- [ ] **Step 1: Build**

```bash
pnpm --filter @asistencia/web build
```

Expected: build output includes `sw.js` and `workbox-*.js` in `apps/web/dist/`.

```bash
ls apps/web/dist/sw.js apps/web/dist/workbox-*.js
```

- [ ] **Step 2: Verify manifest in build output**

```bash
cat apps/web/dist/manifest.webmanifest | python3 -m json.tool | head -10
```

Expected: valid JSON with `name`, `icons`, `display: "standalone"`.

- [ ] **Step 3: Deploy web dist**

```bash
VPS="root@45.55.214.153"
tar -czf /tmp/web-dist.tar.gz -C apps/web/dist .
scp /tmp/web-dist.tar.gz $VPS:/tmp/
ssh $VPS "
  docker cp /tmp/web-dist.tar.gz asistencia_web:/tmp/ &&
  docker exec -u 0 asistencia_web sh -c 'rm -rf /usr/share/nginx/html/* && tar -xzf /tmp/web-dist.tar.gz -C /usr/share/nginx/html' &&
  echo deployed-web
"
```

---

## Verification

1. Open Chrome DevTools → Application → Manifest → app shows as installable (no errors).
2. Application → Service Workers → `sw.js` showing as activated.
3. Application → Cache Storage → `cssp-api-cache` and `cssp-assets-cache` populate after first navigation.
4. DevTools → Network → set to "Offline". Reload `https://asistencia.nicoholas.dev/cursos` → page loads from cache (not blank).
5. Return to online → cached data still shows, fresh data loads in background.
6. Topbar shows "🔴 Sin conexión" badge when offline, disappears when online.
7. On Chrome Android → three-dot menu → "Add to Home Screen" option available.
