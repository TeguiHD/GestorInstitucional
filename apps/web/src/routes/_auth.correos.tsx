import { createFileRoute } from '@tanstack/react-router';

import { MailPage } from '@/features/mail/MailPage';

export const Route = createFileRoute('/_auth/correos')({
  component: MailPage,
});
