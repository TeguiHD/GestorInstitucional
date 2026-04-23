import { createFileRoute } from '@tanstack/react-router';

import { JustificationsPage } from '@/features/justifications/JustificationsPage';

export const Route = createFileRoute('/_auth/justificaciones')({
  component: JustificationsPage,
});
