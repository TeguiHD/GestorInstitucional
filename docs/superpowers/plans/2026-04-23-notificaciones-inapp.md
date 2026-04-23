# Centro de Notificaciones In-App

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un centro de notificaciones in-app: campana en la topbar con badge de no leídas, panel dropdown con historial, y persistencia en BD. El sistema de email/WhatsApp ya existe — este plan conecta esos eventos al canal visual en la UI.

**Architecture:** Modelo `Notification` en Prisma (userId, type, title, body, link, readAt). `NotificationsModule` NestJS con CRUD + endpoint para marcar como leída. Frontend: componente `NotificationBell` (campana + badge) en `AppLayout`, panel dropdown con lista paginada, polling cada 30s con `useQuery` + `refetchInterval`. Cuando el backend envía email de ausencia, también crea un `Notification` para el apoderado. Cuando admin aprueba/rechaza justificación, crea `Notification` para el apoderado dueño.

**Tech Stack:** NestJS + Prisma + MariaDB, React + TanStack Query + Tailwind, TypeScript.

---

## Critical Files

**Backend (create):**

- `apps/api/src/notifications/notifications.module.ts`
- `apps/api/src/notifications/notifications.controller.ts`
- `apps/api/src/notifications/notifications.service.ts`

**Backend (modify):**

- `apps/api/prisma/schema.prisma` — add `Notification` model + `User` relation
- `apps/api/src/app.module.ts` — register `NotificationsModule`
- `apps/api/src/mail/mail.service.ts` — call `NotificationsService.create()` when sending absence/justification emails
- `apps/api/src/justifications/justifications.service.ts` — create notification on review

**Frontend (create):**

- `apps/web/src/features/notifications/NotificationBell.tsx`

**Frontend (modify):**

- `apps/web/src/components/layout/AppLayout.tsx` — add `NotificationBell` to topbar

---

## Task 1: Prisma schema — `Notification` model

**Files:**

- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add relation on `User` and `Notification` model**

In the `User` model, after `trustedDevices TrustedDevice[]` (line ~153), add:

```prisma
  notifications     Notification[]
```

After the `TrustedDevice` model, add:

```prisma
// =============================================================================
// NOTIFICATIONS (in-app)
// =============================================================================

model Notification {
  id        String   @id @default(uuid()) @db.Char(36)
  userId    String   @db.Char(36)
  type      String   @db.VarChar(40)        // ABSENCE | JUSTIFICATION_APPROVED | JUSTIFICATION_REJECTED | ALERT | INFO
  title     String   @db.VarChar(200)
  body      String   @db.VarChar(500)
  link      String?  @db.VarChar(500)       // optional deep-link e.g. "/alumnos/uuid"
  readAt    DateTime?
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt])
  @@index([userId, createdAt])
  @@map("notifications")
}
```

- [ ] **Step 2: Generate migration and client**

```bash
pnpm --filter @asistencia/api exec prisma migrate dev --name add-notifications
pnpm --filter @asistencia/api exec prisma generate
```

Expected: migration SQL in `apps/api/prisma/migrations/`, client regenerated with `notification`/`Notification` types.

---

## Task 2: NotificationsService

**Files:**

- Create: `apps/api/src/notifications/notifications.service.ts`

- [ ] **Step 1: Create service**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type CreateNotificationDto = {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({ data: dto });
  }

  async findForUser(userId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [items, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);
    return { items, unreadCount, page, pageSize };
  }

  async markRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
```

---

## Task 3: NotificationsController

**Files:**

- Create: `apps/api/src/notifications/notifications.controller.ts`

- [ ] **Step 1: Create controller**

```typescript
import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Notificaciones del usuario autenticado' })
  findMine(@CurrentUser() user: JwtPayload, @Query('page') page?: number) {
    return this.notifications.findForUser(user.sub, page ? Number(page) : 1);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar notificación como leída' })
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas como leídas' })
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notifications.markAllRead(user.sub);
  }
}
```

---

## Task 4: NotificationsModule + app.module registration

**Files:**

- Create: `apps/api/src/notifications/notifications.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create module**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 2: Register in app.module.ts**

```typescript
import { NotificationsModule } from './notifications/notifications.module.js';
// Add NotificationsModule to imports array
```

---

## Task 5: Wire notifications to existing events

**Files:**

- Modify: `apps/api/src/mail/mail.service.ts`
- Modify: `apps/api/src/justifications/justifications.service.ts`

- [ ] **Step 1: Inject NotificationsService into MailService**

In `mail.service.ts`, add `NotificationsService` to the constructor (import it). In `sendAbsenceDaily()`, after queuing the email, also create a notification for the guardian:

Find the `sendAbsenceDaily()` call (it receives `guardianId`, `studentName`, `date`, `status`). After the mail queue creation, add:

```typescript
await this.notificationsService.create({
  userId: guardianId,
  type: 'ABSENCE',
  title: `Inasistencia: ${studentName}`,
  body: `${studentName} registró ${status === 'ABSENT' ? 'ausencia' : 'atraso'} el ${date}.`,
  link: `/mis-pupilos`,
});
```

- [ ] **Step 2: Add notification on justification review**

In `justifications.service.ts`, inside `reviewJustification()`, after updating the record status, create a notification for the student's guardian:

```typescript
// After the update, find the guardianship to get guardianId
const justification = await this.prisma.attendanceJustification.findUniqueOrThrow({
  where: { id },
  include: {
    record: {
      include: {
        student: {
          include: {
            guardianships: { where: { isPrimary: true }, select: { guardianId: true }, take: 1 },
          },
        },
      },
    },
  },
});
const primaryGuardianId = justification.record.student.guardianships[0]?.guardianId;
if (primaryGuardianId) {
  const studentName = `${justification.record.student.firstName} ${justification.record.student.lastName}`;
  await this.notificationsService.create({
    userId: primaryGuardianId,
    type: dto.status === 'APPROVED' ? 'JUSTIFICATION_APPROVED' : 'JUSTIFICATION_REJECTED',
    title: dto.status === 'APPROVED' ? 'Justificación aprobada' : 'Justificación rechazada',
    body: `La justificación de ${studentName} fue ${dto.status === 'APPROVED' ? 'aprobada' : 'rechazada'}${dto.reviewNotes ? `: "${dto.reviewNotes}"` : '.'}`,
    link: `/mis-pupilos`,
  });
}
```

- [ ] **Step 3: Typecheck API**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 6: Frontend — `NotificationBell` component

**Files:**

- Create: `apps/web/src/features/notifications/NotificationBell.tsx`

- [ ] **Step 1: Create component**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  readAt: string | null;
  createdAt: string;
};

type NotificationsResponse = {
  items: Notification[];
  unreadCount: number;
  page: number;
};

const TYPE_ICON: Record<string, string> = {
  ABSENCE: '🔴',
  JUSTIFICATION_APPROVED: '✅',
  JUSTIFICATION_REJECTED: '❌',
  ALERT: '⚠️',
  INFO: 'ℹ️',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const markReadMut = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllMut = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative p-2 rounded-lg hover:bg-muted transition-colors',
          open && 'bg-muted',
        )}
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} no leídas)` : ''}`}
      >
        <Bell className="size-5 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 size-4 flex items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-background shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Notificaciones</h3>
            {unread > 0 && (
              <button
                onClick={() => markAllMut.mutate()}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <Check className="size-3" />
                Marcar todas
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-border">
            {!data?.items.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin notificaciones</p>
            ) : (
              data.items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.readAt) markReadMut.mutate(n.id);
                    if (n.link) window.location.href = n.link;
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors',
                    !n.readAt && 'bg-primary/5',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-base mt-0.5 shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            'text-xs font-semibold truncate',
                            !n.readAt && 'text-foreground',
                          )}
                        >
                          {n.title}
                        </p>
                        {!n.readAt && <span className="size-2 rounded-full bg-primary shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(n.createdAt).toLocaleString('es-CL', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Task 7: Add NotificationBell to AppLayout topbar

**Files:**

- Modify: `apps/web/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Locate topbar area in AppLayout**

Find the topbar section in `AppLayout.tsx` — it contains the user name, logout button, and possibly theme toggle. Add the `NotificationBell` to the left of the user section.

Add import:

```tsx
import { NotificationBell } from '@/features/notifications/NotificationBell';
```

In the topbar JSX, add `<NotificationBell />` just before the user/logout controls:

```tsx
<div className="flex items-center gap-1">
  <NotificationBell />
  {/* existing user controls */}
</div>
```

- [ ] **Step 2: Typecheck web**

```bash
pnpm --filter @asistencia/web exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 8: Build + Deploy

- [ ] **Step 1: Build both**

```bash
pnpm --filter @asistencia/api build && pnpm --filter @asistencia/web build
```

- [ ] **Step 2: Apply migration on VPS**

```bash
VPS="root@45.55.214.153"
DB_PASS=$(grep DB_PASSWORD .env.prod | cut -d= -f2)
MIGRATION=$(ls apps/api/prisma/migrations/ | grep notifications | tail -1)
scp "apps/api/prisma/migrations/${MIGRATION}/migration.sql" $VPS:/tmp/migration_notifications.sql
ssh $VPS "docker exec asistencia_db mysql -u asistencia_app -p'${DB_PASS}' asistencia < /tmp/migration_notifications.sql && echo ok"
```

- [ ] **Step 3: Copy Prisma client + deploy dist**

```bash
tar -czf /tmp/prisma-client.tar.gz \
  --exclude='libquery_engine-rhel-*' \
  --exclude='libquery_engine-linux-musl-*' \
  --exclude='libquery_engine-darwin-*' \
  -C node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client .
scp /tmp/prisma-client.tar.gz $VPS:/tmp/
ssh $VPS "docker cp /tmp/prisma-client.tar.gz asistencia_api:/tmp/ && docker exec -u 0 asistencia_api sh -c 'cd /app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client && tar -xzf /tmp/prisma-client.tar.gz && echo prisma-ok'"

tar -czf /tmp/api-dist.tar.gz -C apps/api/dist .
tar -czf /tmp/web-dist.tar.gz -C apps/web/dist .
scp /tmp/api-dist.tar.gz /tmp/web-dist.tar.gz $VPS:/tmp/
ssh $VPS "
  docker cp /tmp/api-dist.tar.gz asistencia_api:/tmp/ &&
  docker exec -u 0 asistencia_api sh -c 'cd /app/apps/api && rm -rf dist && mkdir dist && tar -xzf /tmp/api-dist.tar.gz -C dist' &&
  docker cp /tmp/web-dist.tar.gz asistencia_web:/tmp/ &&
  docker exec -u 0 asistencia_web sh -c 'rm -rf /usr/share/nginx/html/* && tar -xzf /tmp/web-dist.tar.gz -C /usr/share/nginx/html' &&
  docker restart asistencia_api &&
  echo deployed
"
```

- [ ] **Step 4: Verify health**

```bash
curl -s https://asistencia.nicoholas.dev/api/v1/health | python3 -m json.tool
```

Expected: `{"status":"ok","info":{"database":{"status":"up"}}}`.

---

## Verification

1. Login como apoderado. Campana visible en topbar.
2. Ir a `/mis-pupilos`. Marcar manualmente un alumno como ausente (como admin en otra pestaña). Esperar hasta 30s → campana muestra badge rojo con número.
3. Click campana → panel dropdown con notificación "🔴 Inasistencia: [nombre]".
4. Click notificación → navega a `/mis-pupilos`, notificación marcada como leída, punto azul desaparece.
5. "Marcar todas" → badge desaparece.
6. Login como admin, aprobar una justificación → apoderado recibe "✅ Justificación aprobada".
