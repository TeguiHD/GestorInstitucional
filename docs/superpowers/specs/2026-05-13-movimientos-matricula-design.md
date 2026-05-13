# Movimientos de Matrícula — Design Spec

**Fecha:** 2026-05-13  
**Estado:** Aprobado  
**Roles afectados:** INSPECTORIA, DIRECTOR, SUPER_ADMIN

---

## Contexto normativo

Bajo DFL-2/1998 (Ley de Subvenciones) y Decreto 511, el colegio debe registrar movimientos de matrícula con fecha efectiva. Esa fecha determina desde cuándo el establecimiento genera o pierde subvención MINEDUC.

El sistema ya produce la hoja "CONTROL SUBVENCIONES" en el Excel MINEDUC leyendo `EnrollmentEvent`. El schema ya tiene todos los estados necesarios — **no se requieren migraciones**.

---

## Tipos de movimiento

| Tipo              | `EnrollmentStatus` | Campos extra                           |
| ----------------- | ------------------ | -------------------------------------- |
| Nueva matrícula   | `ACTIVE`           | —                                      |
| Traslado entrada  | `TRANSFERRED_IN`   | `reason` = escuela origen              |
| Traslado salida   | `TRANSFERRED_OUT`  | `transferredToSchool` = nombre destino |
| Retiro definitivo | `WITHDRAWN`        | `reason` opcional                      |
| Reingreso         | `RE_ENROLLED`      | `courseId` nuevo (opcional)            |

---

## Arquitectura

### Backend — cambios

**`students.service.ts`**

- `findWithdrawn()`: abrir a DIRECTOR e INSPECTORIA (filtrado por su `schoolId`)
- `restore()`: abrir a DIRECTOR e INSPECTORIA
- `withdraw()`: extender DTO para aceptar `transferType?: 'WITHDRAWN' | 'TRANSFERRED_OUT'` y `transferredToSchool?`; el evento creado depende de `transferType`
- `create()` / `CreateStudentDto`: agregar `transferOriginSchool?`; si está presente, el evento inicial es `TRANSFERRED_IN` en lugar de `ACTIVE`
- Nuevo método `getMovements(schoolId, from, to, actor)`: retorna `EnrollmentEvent[]` del período con `student` y `recordedBy` incluidos

**`students.controller.ts`**

- `GET /students/trash` → agregar `DIRECTOR`, `INSPECTORIA` a `@Roles`
- `POST /students/:id/restore` → agregar `DIRECTOR`, `INSPECTORIA`
- `GET /students/movements` → nuevo endpoint con query params `schoolId`, `from`, `to`
- Extender `EnrollmentMovementDto` con campos de traslado

### Frontend — nuevos archivos

**`apps/web/src/routes/_auth.movimientos.tsx`** (nuevo)  
Panel central de movimientos. Tres tabs:

- **Activos**: tabla de todos los alumnos activos del colegio (todos los cursos). Columnas: N° lista, Nombre, RUT, Curso, Fecha ingreso. Acción: "Dar de baja".
- **Retirados**: alumnos con `active=false`. Columnas: Nombre, RUT, Curso, Fecha retiro, Tipo. Acción: "Reingresar".
- **Historial**: log de `EnrollmentEvent` del período seleccionado. Filtro: mes/año. Exporta el período (enlaza al Excel MINEDUC existente).

Botón prominente fijo: **"Nueva Matrícula"**.

**Dialogs** (en `src/features/enrollment/`):

- `MatricularDialog`: RUT, nombre, apellido(s), fecha nacimiento, curso (select), N° lista (auto), fecha efectiva, toggle "llega de otro colegio" → campo escuela origen
- `DarDeBajaDialog`: fecha efectiva (obligatoria), tipo (Retiro definitivo / Traslado), condicional: escuela destino, motivo (opcional)
- `ReingresarDialog`: curso (select, puede cambiar), N° lista (autoasignado), fecha efectiva

**`AppLayout.tsx`**: agregar item "Movimientos" con ícono `ArrowLeftRight` en grupo Operaciones, visible para INSPECTORIA, DIRECTOR, SUPER_ADMIN (nuevo flag `enrollmentOnly`).

---

## Matriz de permisos

| Acción                  | INSPECTORIA | DIRECTOR | UTP | SUPER_ADMIN |
| ----------------------- | :---------: | :------: | :-: | :---------: |
| Ver panel movimientos   |      ✓      |    ✓     |  —  |      ✓      |
| Nueva matrícula         |      ✓      |    ✓     |  ✓  |      ✓      |
| Dar de baja / Trasladar |      ✓      |    ✓     |  ✓  |      ✓      |
| Reingresar              |      ✓      |    ✓     |  —  |      ✓      |
| Ver retirados           |      ✓      |    ✓     |  —  |      ✓      |
| Purgar (borrado físico) |      —      |    —     |  —  |      ✓      |

---

## Impacto en reportes MINEDUC

El Excel CONTROL SUBVENCIONES ya lee `EnrollmentEvent` correctamente:

- `incorporated` = ACTIVE, RE_ENROLLED, TRANSFERRED_IN
- `withdrawn` = WITHDRAWN, TRANSFERRED_OUT

Con los nuevos dialogs registrando los eventos correctos, el reporte funciona sin modificaciones adicionales. El PDF grid mensual usa `activeDuringPeriodWhere` que ya incluye alumnos que ingresaron o se retiraron durante el período.

---

## Decisiones de diseño

- Fecha efectiva es **obligatoria** en retiro/traslado (normativa MINEDUC).
- N° de lista en nueva matrícula es autoasignado (MAX+1) pero editable para casos de importación.
- Purga física queda exclusiva de SUPER_ADMIN (Ley 21.719).
- No se agrega nueva migración — el schema ya está preparado.
