import { Outlet, createRootRoute } from '@tanstack/react-router';
import { Suspense } from 'react';

import { Toaster } from 'sonner';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PwaLifecycle } from '@/components/PwaLifecycle';

export const Route = createRootRoute({
  component: () => (
    <ErrorBoundary>
      <Suspense>
        <Outlet />
      </Suspense>
      <PwaLifecycle />
      <Toaster richColors position="top-right" />
    </ErrorBoundary>
  ),
});
