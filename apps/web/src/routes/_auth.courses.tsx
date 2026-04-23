import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/courses')({
  beforeLoad: () => {
    throw redirect({ to: '/cursos', replace: true });
  },
});
