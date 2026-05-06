import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { ROLES_REQUIRING_2FA } from '@asistencia/shared';
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
      throw redirect({ to: '/login', search: { reason: undefined } });
    }
    // Privileged roles must have TOTP active — force re-login if not
    const needsTotp = user.roles.some((r) => ROLES_REQUIRING_2FA.includes(r as never));
    if (needsTotp && !user.totpVerified) {
      store.clearAuth();
      throw redirect({ to: '/login', search: { reason: 'totp_required' } });
    }
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});
