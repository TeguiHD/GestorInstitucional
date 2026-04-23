import { createFileRoute } from '@tanstack/react-router';

import { CoursesPage } from '@/features/courses/CoursesPage';

export const Route = createFileRoute('/_auth/cursos/')({
  component: CoursesPage,
});
