import { createFileRoute } from '@tanstack/react-router';

import { CourseDetailPage } from '@/features/courses/CourseDetailPage';

export const Route = createFileRoute('/_auth/cursos/$courseId')({
  component: CourseDetailPage,
});
