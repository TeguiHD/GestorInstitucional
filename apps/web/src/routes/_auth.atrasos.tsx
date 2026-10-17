import { createFileRoute } from '@tanstack/react-router';

import { LatePage } from '@/features/late/LatePage';

export const Route = createFileRoute('/_auth/atrasos')({
  component: LatePage,
});
