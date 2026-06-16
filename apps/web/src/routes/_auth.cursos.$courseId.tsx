import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { CourseDetailPage } from '@/features/courses/CourseDetailPage';

export const Route = createFileRoute('/_auth/cursos/$courseId')({
  validateSearch: z.object({
    focusDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  component: CourseDetailPage,
});
