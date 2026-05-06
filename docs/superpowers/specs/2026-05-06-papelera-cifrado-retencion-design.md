# Diseño: Papelera + Cifrado en Reposo + Retención de Datos

**Fecha:** 2026-05-06  
**Estado:** Aprobado  
**Proyecto:** Asistencia CSSP — Colegio San Sebastián de Paine  
**Normativa:** Ley 19.628, Ley 21.719 (efectiva Dic 2026), MINEDUC

---

## 1. Papelera (Recycle Bin)

### Entidades en papelera

| Entidad                   | Mecanismo soft-delete actual | Cambio                       |
| ------------------------- | ---------------------------- | ---------------------------- |
| `User`                    | `deletedAt DateTime?`        | Ninguno — ya está            |
| `Student`                 | `active: false, withdrawnAt` | Ninguno — ya está            |
| `AttendanceJustification` | Borrado físico (bug)         | Añadir `deletedAt DateTime?` |

### Acceso por rol

| Operación              | Roles permitidos       |
| ---------------------- | ---------------------- |
| Ver papelera           | SUPER_ADMIN            |
| Restaurar              | SUPER_ADMIN            |
| Purgar definitivamente | SUPER_ADMIN únicamente |

### Purga definitiva — anonimización in-place

No se borra el registro de la base de datos. Se anonimizan los campos PII para mantener integridad referencial (FK sin `onDelete: SetNull` en `AttendanceRecord.recordedById`, `AttendanceJustification.uploadedById`, etc.) y cumplir Ley 21.719 (datos no identificables).

**User purge:**

- `email → deleted-{id}@purged.local`
- `firstName, lastName → [Eliminado]`
- `phone → null`
- `passwordHash → randomBytes(32).toString('hex')` (inutilizable)
- Cascades automáticos: `UserSchoolRole`, `TotpSecret`, `RefreshToken`, `TrustedDevice` (ya tienen `onDelete: Cascade`)
- `Guardianship` del guardian: cascade delete (ya configurado)
- Audit event: `AuditAction.DELETE` con `meta: { purged: true, reason: 'GDPR/Ley21719' }`

**Student purge:**

- `rut → 00000000-0`
- `firstName, lastName → [Eliminado]`
- `secondLastName → null`
- `birthDate → null`
- `Guardianship` del student: cascade delete (ya configurado)
- `AttendanceRecord`: se mantienen para estadísticas MINEDUC (no contienen PII directa — solo status + fecha)
- Audit event: `AuditAction.DELETE`

**AttendanceJustification purge:**

- Archivo borrado de disco (`unlink`)
- `fileName → [archivo-eliminado]`
- `filePath → ''`
- `fileHash, fileIv → null`
- `reason → [eliminado]`
- Registro permanece en DB para trazabilidad de la cadena de audit

### API endpoints nuevos

```
GET    /users/trash?schoolId=X          — listar usuarios borrados del colegio
POST   /users/:id/restore              — restaurar usuario
DELETE /users/:id/purge               — anonimizar definitivamente

GET    /students/trash?schoolId=X      — listar alumnos retirados (active=false)
POST   /students/:id/restore           — reactivar alumno
DELETE /students/:id/purge            — anonimizar definitivamente

GET    /justifications/trash?schoolId=X — listar justificaciones borradas
POST   /justifications/:id/restore     — restaurar
DELETE /justifications/:id/purge      — purgar archivo + anonimizar
```

### Frontend

- Ruta: `/papelera` (sidebar, solo SUPER_ADMIN)
- Tres tabs: **Usuarios / Alumnos / Justificaciones**
- Cada fila: nombre/identificador, fecha de eliminación, botones Restaurar y Purgar
- Modal de confirmación typed: usuario escribe `"ELIMINAR"` antes de purgar
- Toast de éxito/error en cada operación

---

## 2. Cifrado de Archivos en Reposo

### Algoritmo

- **AES-256-GCM** — autenticado, detecta tampering
- IV: 12 bytes aleatorios por archivo, generado en cada upload
- Clave: `FILE_ENC_KEY` en `.env` — exactamente 64 hex chars (32 bytes)
- Auth tag GCM: 16 bytes, concatenado al final del archivo cifrado

### Formato en disco

```
[IV 12 bytes][ciphertext...][GCM auth tag 16 bytes]
```

### Schema change

```prisma
model AttendanceJustification {
  ...
  fileIv  String?  @db.VarChar(24)  // hex del IV (12 bytes = 24 hex chars), null = sin cifrar
  ...
}
```

### Lógica de upload (nuevos archivos)

```
generar IV (12 bytes)
→ createCipheriv('aes-256-gcm', key, iv)
→ pipeline(fileStream, counter, cipher, writeStream)
→ appendFileSync(path, cipher.getAuthTag())  // 16 bytes al final
→ DB: fileIv = iv.toString('hex')
```

### Lógica de descarga

```
si fileIv IS NULL → serve sin descifrar (legacy no cifrado)
si fileIv NOT NULL →
  leer primeros bytes: skip IV (ya en DB), leer hasta len-16 como ciphertext, últimos 16 = tag
  createDecipheriv('aes-256-gcm', key, Buffer.from(fileIv, 'hex'))
  decipher.setAuthTag(lastBytes)
  pipe(decryptedStream → response)
```

Implementación práctica: leer todo el archivo en buffer (max 8 MB), separar tag, descifrar, stream el resultado. Evita complejidad de stream parcial con GCM.

### Migración de archivos existentes

Script: `apps/api/scripts/encrypt-existing-files.ts`

```
para cada AttendanceJustification donde fileIv IS NULL:
  1. leer archivo de disco
  2. generar nuevo IV
  3. cifrar buffer completo
  4. escribir buffer cifrado al mismo path
  5. UPDATE DB: fileIv = iv.toString('hex')
  6. log progreso
```

El script es idempotente (salta registros con `fileIv != null`). Corre como parte del deploy post-migrate, antes de reiniciar el contenedor API.

### Env var nueva

```
FILE_ENC_KEY=<64 hex chars>   # openssl rand -hex 32
```

---

## 3. Retención de Datos (MINEDUC)

### Períodos fijos (no configurables)

| Tabla                       | Retención                       | Fundamento                     |
| --------------------------- | ------------------------------- | ------------------------------ |
| `attendance_records`        | 5 años desde fin de año escolar | Libro de clases MINEDUC        |
| `attendance_justifications` | 5 años                          | Documentos de respaldo         |
| `audit_events`              | 3 años                          | Ley 19.628 registros de acceso |
| `mail_outbox`               | 1 año                           | Datos operativos               |
| `alert_fired`               | 1 año                           | Datos operativos               |
| `refresh_tokens` expirados  | 30 días                         | Seguridad                      |

### Resumen pre-purga de AttendanceRecord

Antes de purgar registros de asistencia, el sistema genera un `DataRetentionSnapshot` por año y colegio con totales agregados (presentes/ausentes/atrasados por curso), guardado como JSON en una nueva tabla `retention_snapshots`. Esto preserva valor estadístico para MINEDUC sin datos personales.

### Schema change

```prisma
model RetentionSnapshot {
  id        String   @id @default(uuid()) @db.Char(36)
  schoolId  String   @db.Char(36)
  year      Int
  summary   Json     // { courses: [{ id, code, name, total, present, absent, late }] }
  createdAt DateTime @default(now())

  school School @relation(fields: [schoolId], references: [id])

  @@unique([schoolId, year])
  @@map("retention_snapshots")
}
```

### API

```
GET  /admin/retention/preview   — muestra conteo de registros que serían purgados (dry run)
POST /admin/retention/purge     — ejecuta purga (SUPER_ADMIN only)
```

Response de preview:

```json
{
  "attendanceRecords": 1240,
  "justifications": 12,
  "auditEvents": 3400,
  "mailOutbox": 890,
  "alertFired": 45,
  "refreshTokens": 120,
  "snapshotsToGenerate": ["2020", "2021"]
}
```

---

## 4. Optimización getSchoolStats

### Problema actual

`getSchoolStats` carga todos los `AttendanceRecord` del período en Node.js y agrupa en-memory. Para 383 alumnos × 90 días = ~34k registros en RAM por llamada.

### Fix

Usar Prisma `groupBy` por `[courseId, status]` a nivel DB.

```typescript
const nonSchoolDates = Array.from(nonSchool.keys()); // Set<string> → string[]
const grouped = await this.prisma.attendanceRecord.groupBy({
  by: ['courseId', 'status'],
  where: {
    courseId: { in: courseIds },
    date: {
      gte: fromDate,
      lte: toDate,
      notIn: nonSchoolDates.map((d) => new Date(d)),
    },
  },
  _count: { _all: true },
});
```

Resultado: una sola query con GROUP BY en MariaDB, retorna solo los agregados (~N_courses × 4_statuses filas).

---

## Archivos a crear/modificar

### Schema + Migrations

- `prisma/schema.prisma` — añadir `fileIv`, `deletedAt` en Justification, `RetentionSnapshot`
- `migrations/20260506000300_papelera_cifrado_retencion/migration.sql`

### Backend API

| Archivo                             | Cambio                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `justifications.service.ts`         | soft-delete en `remove()`, encrypt/decrypt en upload/getFile, `listTrash`, `restore`, `purge` |
| `justifications.controller.ts`      | endpoints trash/restore/purge                                                                 |
| `users.service.ts`                  | `findTrashed`, `restore`, `purge`                                                             |
| `users.controller.ts`               | endpoints trash/restore/purge                                                                 |
| `students.service.ts`               | `findWithdrawn` (ya hay lógica), `restore`, `purge`                                           |
| `students.controller.ts`            | endpoints trash/restore/purge                                                                 |
| `attendance.service.ts`             | optimizar `getSchoolStats` con groupBy                                                        |
| `retention/retention.service.ts`    | nuevo — lógica de cálculo y ejecución de purga                                                |
| `retention/retention.controller.ts` | nuevo — endpoints preview/purge                                                               |
| `retention/retention.module.ts`     | nuevo                                                                                         |
| `app.module.ts`                     | importar RetentionModule                                                                      |
| `scripts/encrypt-existing-files.ts` | nuevo — migración cifrado                                                                     |

### Frontend

| Archivo                                  | Cambio                                  |
| ---------------------------------------- | --------------------------------------- |
| `routes/_auth.papelera.tsx`              | nueva ruta con 3 tabs                   |
| `routeTree.gen.ts`                       | regenerado por TanStack Router          |
| `components/ui/typed-confirm-dialog.tsx` | modal typed-confirmation reutilizable   |
| sidebar                                  | añadir link Papelera (solo SUPER_ADMIN) |

---

## Consideraciones de seguridad

- `FILE_ENC_KEY` nunca va a logs ni respuestas API
- El script de migración valida que `FILE_ENC_KEY` esté set antes de empezar
- Purga requiere SUPER_ADMIN verificado en JWT (no solo role claim)
- Typed-confirm en frontend es UX, no seguridad — la autorización es siempre en backend
- Anonimización es atómica en una transacción Prisma

## Riesgos

| Riesgo                                          | Mitigación                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Script cifrado corrompe archivo                 | Backup pre-deploy obligatorio (ya implementado)                        |
| `FILE_ENC_KEY` se rota → archivos indescifrable | Documentar: rotar clave = re-cifrar todos los archivos con nueva clave |
| Purga masiva accidental                         | Preview obligatorio antes de purge, typed-confirm, audit log           |
