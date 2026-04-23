import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/students/$studentId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/alumnos/$studentId',
      params: { studentId: params.studentId },
      replace: true,
    });
  },
});
