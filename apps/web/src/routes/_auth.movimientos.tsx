import { createFileRoute, redirect } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth.store';
import { MovimientosPage } from '@/features/enrollment/MovimientosPage';

export const Route = createFileRoute('/_auth/movimientos')({
  beforeLoad: () => {
    const user = useAuthStore.getState().user;
    const allowed = ['SUPER_ADMIN', 'DIRECTOR', 'INSPECTORIA'];
    if (user && !user.roles.some((r: string) => allowed.includes(r))) {
      throw redirect({ to: '/', replace: true });
    }
  },
  component: MovimientosPage,
});
