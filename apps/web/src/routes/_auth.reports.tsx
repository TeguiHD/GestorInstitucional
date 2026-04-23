import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/reports')({
  beforeLoad: () => {
    throw redirect({ to: '/reportes', replace: true });
  },
});
