import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/my-children')({
  beforeLoad: () => {
    throw redirect({ to: '/mis-pupilos', replace: true });
  },
});
