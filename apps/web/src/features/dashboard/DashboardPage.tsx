import { Navigate } from '@tanstack/react-router';

import { useUser } from '@/stores/auth.store';

import { DirectorDashboard } from './DirectorDashboard';
import { ProfesorDashboard } from './ProfesorDashboard';

export function DashboardPage() {
  const user = useUser();
  const roles = user?.roles ?? [];

  if (roles.includes('APODERADO')) {
    return <Navigate to="/mis-pupilos" replace />;
  }

  if (
    roles.includes('PROFESOR') &&
    !roles.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP'].includes(r))
  ) {
    return <ProfesorDashboard />;
  }

  return <DirectorDashboard />;
}
