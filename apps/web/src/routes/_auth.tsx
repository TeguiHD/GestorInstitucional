import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/stores/auth.store';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async () => {
    const store = useAuthStore.getState();
    // If no access token in memory, try to restore from httpOnly cookie
    if (!store.accessToken) {
      await store.init();
    }
    const { accessToken, user } = useAuthStore.getState();
    if (!accessToken || !user) {
      throw redirect({ to: '/login' });
    }
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});
