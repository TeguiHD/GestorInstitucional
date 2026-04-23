import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/calendar')({
  beforeLoad: () => {
    throw redirect({ to: '/calendario', replace: true });
  },
});
