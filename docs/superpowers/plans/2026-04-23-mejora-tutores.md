# Mejora de Contacto Tutores

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enriquecer el panel de apoderados: múltiples teléfonos/contactos por apoderado (tipo, WhatsApp, prioridad), preferencias de notificación por vínculo (ausencias, atrasos, resumen semanal), y UI para gestionar ambos desde `StudentDetailPage`.

**Architecture:** `GuardianContact` Prisma model separado (pertenece a un `User` con rol APODERADO, no al vínculo). Preferencias de notificación (`notifyAbsences`, `notifyLate`, `notifyWeeklyDigest`) van en `Guardianship` (ya existe). Backend: nuevos endpoints CRUD en `StudentsController` para contactos y PATCH en guardianship para prefs. Frontend: sección expandida en el panel de apoderados existente de `StudentDetailPage`.

**Tech Stack:** NestJS + Prisma 5.22 + MariaDB (backend), React + TanStack Query + Tailwind (frontend), TypeScript.

---

## Critical Files

**Backend (modify):**

- `apps/api/prisma/schema.prisma` — add `GuardianContact` model + relation on `User` + notification prefs on `Guardianship`
- `apps/api/src/students/students.controller.ts` — add contacts CRUD + PATCH guardianship prefs endpoints
- `apps/api/src/students/students.service.ts` — implement contacts CRUD + updateGuardianshipPrefs
- `apps/api/src/students/dto/` — create DTOs

**Frontend (modify):**

- `apps/web/src/features/students/StudentDetailPage.tsx` — enhanced guardian panel with contacts + prefs

---

## Task 1: Prisma schema — `GuardianContact` + Guardianship prefs

**Files:**

- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add notification prefs to `Guardianship` model**

Locate the `Guardianship` model (line ~317). Add three fields before `createdAt`:

```prisma
model Guardianship {
  id          String   @id @default(uuid()) @db.Char(36)
  guardianId  String   @db.Char(36)
  studentId   String   @db.Char(36)
  relation    String   @db.VarChar(40)
  isPrimary   Boolean  @default(false)
  notifyAbsences     Boolean  @default(true)
  notifyLate         Boolean  @default(true)
  notifyWeeklyDigest Boolean  @default(false)
  createdAt   DateTime @default(now())

  guardian User    @relation(fields: [guardianId], references: [id], onDelete: Cascade)
  student  Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([guardianId, studentId])
  @@index([studentId])
  @@map("guardianships")
}
```

- [ ] **Step 2: Add `GuardianContact` model and relation on `User`**

In the `User` model, after `trustedDevices  TrustedDevice[]` (line ~153), add:

```prisma
  guardianContacts  GuardianContact[]
```

After the `Guardianship` model (line ~331), add:

```prisma
model GuardianContact {
  id          String   @id @default(uuid()) @db.Char(36)
  userId      String   @db.Char(36)           // the APODERADO user
  type        String   @db.VarChar(20)         // MOBILE | HOME | WORK | EMERGENCY
  phone       String   @db.VarChar(30)
  label       String?  @db.VarChar(80)         // e.g. "Mamá celular"
  isWhatsApp  Boolean  @default(false)
  priority    Int      @default(0)             // 0 = primary, ascending
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("guardian_contacts")
}
```

- [ ] **Step 3: Generate migration and client**

```bash
pnpm --filter @asistencia/api exec prisma migrate dev --name add-guardian-contacts-and-prefs
pnpm --filter @asistencia/api exec prisma generate
```

Expected: migration SQL created in `apps/api/prisma/migrations/`, Prisma client regenerated with `guardianContact`/`GuardianContact` types.

---

## Task 2: Backend DTOs

**Files:**

- Create: `apps/api/src/students/dto/create-guardian-contact.dto.ts`
- Create: `apps/api/src/students/dto/update-guardianship-prefs.dto.ts`

- [ ] **Step 1: Create `create-guardian-contact.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGuardianContactDto {
  @ApiProperty({ enum: ['MOBILE', 'HOME', 'WORK', 'EMERGENCY'] })
  @IsIn(['MOBILE', 'HOME', 'WORK', 'EMERGENCY'])
  type!: string;

  @ApiProperty({ example: '+56912345678' })
  @IsString()
  @Matches(/^\+?[\d\s\-().]{7,20}$/, { message: 'Teléfono inválido' })
  phone!: string;

  @ApiPropertyOptional({ example: 'Mamá celular' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isWhatsApp?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
```

- [ ] **Step 2: Create `update-guardianship-prefs.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateGuardianshipPrefsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyAbsences?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyLate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyWeeklyDigest?: boolean;
}
```

---

## Task 3: Backend service methods

**Files:**

- Modify: `apps/api/src/students/students.service.ts`

- [ ] **Step 1: Add contacts CRUD methods**

Add to the `StudentsService` class, after `removeGuardian()`:

```typescript
async listGuardianContacts(studentId: string, guardianId: string) {
  // verify guardianship exists for this student
  await this.prisma.guardianship.findUniqueOrThrow({
    where: { guardianId_studentId: { guardianId, studentId } },
    select: { id: true },
  });
  return this.prisma.guardianContact.findMany({
    where: { userId: guardianId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
}

async addGuardianContact(
  studentId: string,
  guardianId: string,
  dto: import('./dto/create-guardian-contact.dto.js').CreateGuardianContactDto,
) {
  await this.prisma.guardianship.findUniqueOrThrow({
    where: { guardianId_studentId: { guardianId, studentId } },
    select: { id: true },
  });
  return this.prisma.guardianContact.create({
    data: {
      userId: guardianId,
      type: dto.type,
      phone: dto.phone,
      label: dto.label ?? null,
      isWhatsApp: dto.isWhatsApp ?? false,
      priority: dto.priority ?? 0,
    },
  });
}

async removeGuardianContact(studentId: string, guardianId: string, contactId: string) {
  // security: verify contact belongs to guardian who is linked to this student
  await this.prisma.guardianship.findUniqueOrThrow({
    where: { guardianId_studentId: { guardianId, studentId } },
    select: { id: true },
  });
  await this.prisma.guardianContact.deleteMany({
    where: { id: contactId, userId: guardianId },
  });
}

async updateGuardianshipPrefs(
  studentId: string,
  guardianId: string,
  dto: import('./dto/update-guardianship-prefs.dto.js').UpdateGuardianshipPrefsDto,
) {
  return this.prisma.guardianship.update({
    where: { guardianId_studentId: { guardianId, studentId } },
    data: {
      ...(dto.notifyAbsences !== undefined ? { notifyAbsences: dto.notifyAbsences } : {}),
      ...(dto.notifyLate !== undefined ? { notifyLate: dto.notifyLate } : {}),
      ...(dto.notifyWeeklyDigest !== undefined ? { notifyWeeklyDigest: dto.notifyWeeklyDigest } : {}),
    },
  });
}
```

- [ ] **Step 2: Update `listGuardians` to include contacts and prefs**

Find the `listGuardians` method and update its `include` to include contacts and prefs:

```typescript
async listGuardians(studentId: string) {
  return this.prisma.guardianship.findMany({
    where: { studentId },
    include: {
      guardian: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          guardianContacts: {
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
}
```

---

## Task 4: Backend controller endpoints

**Files:**

- Modify: `apps/api/src/students/students.controller.ts`

- [ ] **Step 1: Add imports and new endpoints**

Add to the top imports:

```typescript
import { CreateGuardianContactDto } from './dto/create-guardian-contact.dto.js';
import { UpdateGuardianshipPrefsDto } from './dto/update-guardianship-prefs.dto.js';
```

After the `removeGuardian` endpoint, add:

```typescript
@Get(':id/guardians/:guardianId/contacts')
@ApiOperation({ summary: 'Listar teléfonos de un apoderado' })
listGuardianContacts(@Param('id') id: string, @Param('guardianId') guardianId: string) {
  return this.students.listGuardianContacts(id, guardianId);
}

@Post(':id/guardians/:guardianId/contacts')
@ApiOperation({ summary: 'Agregar teléfono a un apoderado' })
addGuardianContact(
  @Param('id') id: string,
  @Param('guardianId') guardianId: string,
  @Body() dto: CreateGuardianContactDto,
) {
  return this.students.addGuardianContact(id, guardianId, dto);
}

@Delete(':id/guardians/:guardianId/contacts/:contactId')
@ApiOperation({ summary: 'Eliminar teléfono de apoderado' })
removeGuardianContact(
  @Param('id') id: string,
  @Param('guardianId') guardianId: string,
  @Param('contactId') contactId: string,
) {
  return this.students.removeGuardianContact(id, guardianId, contactId);
}

@Patch(':id/guardians/:guardianId/prefs')
@ApiOperation({ summary: 'Actualizar preferencias de notificación del vínculo' })
updateGuardianshipPrefs(
  @Param('id') id: string,
  @Param('guardianId') guardianId: string,
  @Body() dto: UpdateGuardianshipPrefsDto,
) {
  return this.students.updateGuardianshipPrefs(id, guardianId, dto);
}
```

Also add `Patch` to the imports from `@nestjs/common`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
```

- [ ] **Step 2: Typecheck API**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 5: Frontend — enhanced guardian panel

**Files:**

- Modify: `apps/web/src/features/students/StudentDetailPage.tsx`

- [ ] **Step 1: Update `Guardian` type to include contacts and prefs**

Replace the existing `Guardian` type (line ~47):

```typescript
type GuardianContact = {
  id: string;
  type: string;
  phone: string;
  label?: string;
  isWhatsApp: boolean;
  priority: number;
};

type Guardian = {
  guardianId: string;
  studentId: string;
  relation: string;
  isPrimary: boolean;
  notifyAbsences: boolean;
  notifyLate: boolean;
  notifyWeeklyDigest: boolean;
  guardian: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    status: string;
    guardianContacts: GuardianContact[];
  };
};
```

- [ ] **Step 2: Add contact form state**

After the existing `guardianForm` state, add:

```typescript
const [expandedGuardian, setExpandedGuardian] = useState<string | null>(null);
const [contactForm, setContactForm] = useState({
  type: 'MOBILE',
  phone: '',
  label: '',
  isWhatsApp: false,
});
```

- [ ] **Step 3: Add mutations for contacts and prefs**

After `removeGuardianMut`, add:

```typescript
const addContactMut = useMutation({
  mutationFn: ({ guardianId, data }: { guardianId: string; data: typeof contactForm }) =>
    api.post(`/students/${studentId}/guardians/${guardianId}/contacts`, data),
  onSuccess: () => {
    toast.success('Teléfono agregado');
    setContactForm({ type: 'MOBILE', phone: '', label: '', isWhatsApp: false });
    void qc.invalidateQueries({ queryKey: ['student-guardians', studentId] });
  },
  onError: (e: unknown) => toast.error((e as Error).message),
});

const removeContactMut = useMutation({
  mutationFn: ({ guardianId, contactId }: { guardianId: string; contactId: string }) =>
    api.del(`/students/${studentId}/guardians/${guardianId}/contacts/${contactId}`),
  onSuccess: () => {
    toast.success('Teléfono eliminado');
    void qc.invalidateQueries({ queryKey: ['student-guardians', studentId] });
  },
  onError: (e: unknown) => toast.error((e as Error).message),
});

const updatePrefsMut = useMutation({
  mutationFn: ({
    guardianId,
    prefs,
  }: {
    guardianId: string;
    prefs: { notifyAbsences?: boolean; notifyLate?: boolean; notifyWeeklyDigest?: boolean };
  }) => api.patch(`/students/${studentId}/guardians/${guardianId}/prefs`, prefs),
  onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['student-guardians', studentId] });
  },
  onError: (e: unknown) => toast.error((e as Error).message),
});
```

- [ ] **Step 4: Replace guardian table with expanded card layout**

Replace the `<table>` block inside the guardians section (the `{guardians.map(...)}` block) with:

```tsx
<div className="divide-y divide-border">
  {guardians.map((g) => {
    const isExpanded = expandedGuardian === g.guardianId;
    const contacts = g.guardian.guardianContacts;
    const CONTACT_TYPE_LABEL: Record<string, string> = {
      MOBILE: 'Celular',
      HOME: 'Casa',
      WORK: 'Trabajo',
      EMERGENCY: 'Emergencia',
    };
    return (
      <div key={g.guardianId}>
        {/* Guardian header row */}
        <div
          className="px-5 py-3 hover:bg-muted/20 transition cursor-pointer"
          onClick={() => setExpandedGuardian(isExpanded ? null : g.guardianId)}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium flex items-center gap-1.5 text-sm">
                {g.guardian.firstName} {g.guardian.lastName}
                {g.isPrimary && <Star className="size-3.5 text-amber-500 fill-amber-500" />}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                <span>{g.relation}</span>
                <span>·</span>
                <span>{g.guardian.email}</span>
                {contacts.length > 0 && (
                  <span className="text-primary">· {contacts.length} tel.</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                title="Copiar email"
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(g.guardian.email);
                  toast.success('Email copiado');
                }}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground"
              >
                <Copy className="size-3.5" />
              </button>
              <button
                title="Desvincular"
                onClick={(e) => {
                  e.stopPropagation();
                  removeGuardianMut.mutate(g.guardianId);
                }}
                className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Expanded panel */}
        {isExpanded && (
          <div className="px-5 pb-4 bg-muted/10 border-t border-border space-y-4">
            {/* Contacts list */}
            <div className="pt-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Teléfonos
              </p>
              {contacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin teléfonos registrados</p>
              ) : (
                <div className="space-y-1.5">
                  {contacts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {CONTACT_TYPE_LABEL[c.type] ?? c.type}
                        </span>
                        <a
                          href={
                            c.isWhatsApp
                              ? `https://wa.me/${c.phone.replace(/\D/g, '')}`
                              : `tel:${c.phone}`
                          }
                          target={c.isWhatsApp ? '_blank' : undefined}
                          rel="noopener noreferrer"
                          className="font-medium hover:text-primary"
                        >
                          {c.phone}
                        </a>
                        {c.isWhatsApp && <span className="text-xs text-green-600">WhatsApp</span>}
                        {c.label && (
                          <span className="text-xs text-muted-foreground">{c.label}</span>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          removeContactMut.mutate({ guardianId: g.guardianId, contactId: c.id })
                        }
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add contact form */}
              <div className="flex flex-wrap gap-2 pt-1">
                <select
                  value={contactForm.type}
                  onChange={(e) => setContactForm({ ...contactForm, type: e.target.value })}
                  className="rounded-lg border border-border px-2 py-1.5 text-xs bg-background"
                >
                  <option value="MOBILE">Celular</option>
                  <option value="HOME">Casa</option>
                  <option value="WORK">Trabajo</option>
                  <option value="EMERGENCY">Emergencia</option>
                </select>
                <input
                  placeholder="+56912345678"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  className="rounded-lg border border-border px-2 py-1.5 text-xs bg-background w-32"
                />
                <input
                  placeholder="Etiqueta (opcional)"
                  value={contactForm.label}
                  onChange={(e) => setContactForm({ ...contactForm, label: e.target.value })}
                  className="rounded-lg border border-border px-2 py-1.5 text-xs bg-background w-32"
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={contactForm.isWhatsApp}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, isWhatsApp: e.target.checked })
                    }
                    className="rounded"
                  />
                  WhatsApp
                </label>
                <button
                  onClick={() =>
                    addContactMut.mutate({ guardianId: g.guardianId, data: contactForm })
                  }
                  disabled={!contactForm.phone || addContactMut.isPending}
                  className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                >
                  Agregar
                </button>
              </div>
            </div>

            {/* Notification prefs */}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Notificaciones
              </p>
              <div className="space-y-1.5">
                {[
                  ['notifyAbsences', 'Ausencias', g.notifyAbsences] as const,
                  ['notifyLate', 'Atrasos', g.notifyLate] as const,
                  ['notifyWeeklyDigest', 'Resumen semanal', g.notifyWeeklyDigest] as const,
                ].map(([key, label, value]) => (
                  <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) =>
                        updatePrefsMut.mutate({
                          guardianId: g.guardianId,
                          prefs: { [key]: e.target.checked },
                        })
                      }
                      className="rounded"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  })}
</div>
```

- [ ] **Step 5: Typecheck web**

```bash
pnpm --filter @asistencia/web exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 6: Build + Deploy

- [ ] **Step 1: Build both**

```bash
pnpm --filter @asistencia/api build && pnpm --filter @asistencia/web build
```

Expected: 0 errors on both.

- [ ] **Step 2: Apply DB migration on VPS**

```bash
VPS="root@45.55.214.153"
DB_PASS=$(grep DB_PASSWORD .env.prod | cut -d= -f2)
MIGRATION_DIR=$(ls apps/api/prisma/migrations/ | grep "guardian_contacts" | tail -1)
scp "apps/api/prisma/migrations/${MIGRATION_DIR}/migration.sql" $VPS:/tmp/migration.sql
ssh $VPS "docker exec asistencia_db mysql -u asistencia_app -p'${DB_PASS}' asistencia < /tmp/migration.sql && echo 'migration ok'"
```

- [ ] **Step 3: Copy new Prisma client to API container**

Prisma client lives in `node_modules`, NOT in `dist/`. Must copy after schema change:

```bash
tar -czf /tmp/prisma-client.tar.gz \
  --exclude='libquery_engine-rhel-*' \
  --exclude='libquery_engine-linux-musl-*' \
  -C node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client .

scp /tmp/prisma-client.tar.gz $VPS:/tmp/
ssh $VPS "docker cp /tmp/prisma-client.tar.gz asistencia_api:/tmp/ && docker exec -u 0 asistencia_api sh -c 'cd /app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client && tar -xzf /tmp/prisma-client.tar.gz && echo prisma-ok'"
```

- [ ] **Step 4: Deploy API and web dist**

```bash
tar -czf /tmp/api-dist.tar.gz -C apps/api/dist .
tar -czf /tmp/web-dist.tar.gz -C apps/web/dist .
scp /tmp/api-dist.tar.gz /tmp/web-dist.tar.gz root@45.55.214.153:/tmp/

ssh root@45.55.214.153 "
  docker cp /tmp/api-dist.tar.gz asistencia_api:/tmp/ && \
  docker exec -u 0 asistencia_api sh -c 'cd /app/apps/api && rm -rf dist && mkdir dist && tar -xzf /tmp/api-dist.tar.gz -C dist' && \
  docker cp /tmp/web-dist.tar.gz asistencia_web:/tmp/ && \
  docker exec -u 0 asistencia_web sh -c 'rm -rf /usr/share/nginx/html/* && tar -xzf /tmp/web-dist.tar.gz -C /usr/share/nginx/html' && \
  docker restart asistencia_api && \
  echo 'deployed'
"
```

- [ ] **Step 5: Verify health**

```bash
curl -s https://asistencia.nicoholas.dev/api/v1/health | python3 -m json.tool
```

Expected: `{"status":"ok","info":{"database":{"status":"up"}}}`.

---

## Verification

1. Abrir `StudentDetailPage` de un alumno que tenga apoderado.
2. Panel "Apoderados" muestra tarjeta clickeable por apoderado.
3. Click en tarjeta → se expande mostrando "Teléfonos" (vacío inicialmente) y "Notificaciones" con 3 checkboxes.
4. Agregar teléfono celular con WhatsApp → aparece en lista con enlace `wa.me/...`.
5. Marcar/desmarcar "Ausencias" → cambio persiste al refrescar.
6. Eliminar teléfono → desaparece de la lista.
7. Click nuevamente en tarjeta → se contrae.
