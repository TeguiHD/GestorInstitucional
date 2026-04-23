import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/users')({
  beforeLoad: () => {
    throw redirect({ to: '/usuarios', replace: true });
  },
});
