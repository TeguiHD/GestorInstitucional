import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/mail')({
  beforeLoad: () => {
    throw redirect({ to: '/correos', replace: true });
  },
});
