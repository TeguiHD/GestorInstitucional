import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { StudentDetailPage } from '@/features/students/StudentDetailPage';

export const Route = createFileRoute('/_auth/alumnos/$studentId')({
  validateSearch: z.object({ courseId: z.string().optional() }),
  component: StudentDetailPage,
});
