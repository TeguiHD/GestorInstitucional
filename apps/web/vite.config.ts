import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

  return {
    plugins: [
      TanStackRouterVite(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false, // use existing public/manifest.webmanifest
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/asistencia\.nicoholas\.dev\/api\/v1\/attendance/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'attendance-api',
                networkTimeoutSeconds: 5,
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/asistencia\.nicoholas\.dev\/api\/v1\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 8,
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    optimizeDeps: { exclude: ['@asistencia/shared'] },
    ssr: { noExternal: ['@asistencia/shared'] },
    resolve: {
      preserveSymlinks: false,
      alias: [
        { find: /^@\//, replacement: path.resolve(__dirname, 'src') + '/' },
        {
          find: /^@asistencia\/shared$/,
          replacement: path.resolve(__dirname, '../../packages/shared/src/index.ts'),
        },
        {
          find: /^@asistencia\/shared\/(.*)$/,
          replacement: path.resolve(__dirname, '../../packages/shared/src/$1'),
        },
      ],
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api/v1': {
          target: apiBase.replace(/\/api\/v1$/, ''),
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            router: ['@tanstack/react-router'],
            query: ['@tanstack/react-query'],
            charts: ['recharts'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
    },
  };
});
