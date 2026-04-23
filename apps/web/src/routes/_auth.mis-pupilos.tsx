import { createFileRoute } from '@tanstack/react-router';

import { MyChildrenPage } from '@/features/guardian/MyChildrenPage';

export const Route = createFileRoute('/_auth/mis-pupilos')({
  component: MyChildrenPage,
});
