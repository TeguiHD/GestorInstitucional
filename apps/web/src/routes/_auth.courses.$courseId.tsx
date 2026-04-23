import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/courses/$courseId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/cursos/$courseId',
      params: { courseId: params.courseId },
      replace: true,
    });
  },
});
