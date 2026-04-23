import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/justifications')({
  beforeLoad: () => {
    throw redirect({ to: '/justificaciones', replace: true });
  },
});
