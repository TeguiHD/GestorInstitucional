import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/audit')({
  beforeLoad: () => {
    throw redirect({ to: '/auditoria', replace: true });
  },
});
