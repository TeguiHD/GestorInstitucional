# Atrasos pendientes de resolución — diseño

**Fecha:** 2026-10-17 · **Pedido por:** Inspectoría CSSP (vía Nicolás)

## Por qué

La inspectora pidió que un atraso **no cuente como asistencia ni como inasistencia**
mientras no se resuelva, pero que **sí se contabilice como atraso**. Hoy `LATE`
cuenta como presente en todo el sistema (`PRESENT_LATE_OVER_TOTAL_CLASSES_V1`).

Encaja con la práctica normativa (Circulares N°1/N°3 Supereduc, recogidas en
procedimientos de colegios): el registro oficial de asistencia es **binario**
(presente/ausente); el atraso se anota aparte; un alumno que llega después de la
2ª hora puede quedar presente solo con documento que lo respalde (p. ej. hora
médica). La vigencia exacta tras la Circular N°30 (2021) queda por confirmar con
el colegio; el diseño no depende de la hora de corte, porque la decisión la toma
la inspectora.

## Reglas

1. **Atraso pendiente** = registro con `status = LATE`. No suma ni resta en el %:
   se excluye del numerador **y** del denominador.
2. **Marca de atraso** = nueva columna `wasLate`. Se pone en `true` al registrar
   `LATE` y **sobrevive** a la resolución: el conteo de atrasos no baja porque
   alguien resolvió el caso.
3. **Resolución**: Inspectoría (SUPER*ADMIN, DIRECTOR, UTP, INSPECTORIA) pasa el
   atraso a `PRESENT` o `ABSENT`, sin plazo. Desde la pantalla \_Atrasos* (en lote)
   o desde la grilla del curso.
4. **Justificación aprobada** de un atraso (pendiente o ya resuelto) ⇒ `PRESENT`.
   Una inasistencia normal justificada sigue quedando `JUSTIFIED` (sin cambios).
5. **Corrección del profesor**: si un PROFESOR cambia en la grilla un `LATE` a otro
   estado, es una corrección de captura (marcó mal) ⇒ `wasLate = false`. Si lo hace
   un rol de Inspectoría, es una resolución ⇒ `wasLate` se conserva.
6. **Atrasos existentes** (registrados con la regla vieja, ~940): la migración los
   convierte a `PRESENT` + `wasLate = true`. Los % ya informados no cambian, el
   conteo de atrasos se conserva y la inspectora **no** recibe una bandeja de
   cientos de pendientes. La conversión queda en la auditoría con la lista exacta
   de IDs (reversible).

## Fórmula (V2: `PRESENT_OVER_CLASSES_EXCL_PENDING_LATE_V2`)

```
clasesEfectivas = totalClases − atrasosPendientes
%               = presentes / clasesEfectivas      (null si clasesEfectivas = 0)
faltantes       = max(0, clasesEfectivas − (presentes + ausentes + justificados))
atrasos         = registros con wasLate (pendientes + resueltos)
```

`JUSTIFIED` sigue sin contar como asistencia (sin cambios). Para rachas de
inasistencia, un atraso pendiente **no** es ausencia (el alumno llegó).

## Informes y grilla MINEDUC

- Celda de atraso pendiente: `AT` (naranja), leyenda “atraso pendiente de
  resolver — no cuenta en el %”. Un atraso resuelto se ve como su estado final
  (`1` / `0` / `J`). En la grilla web lleva además un punto naranja (“fue atraso”).
- Columna `AT` de totales = atrasos del período (con marca), informativa.
- `% = P / (días hábiles − atrasos pendientes)`; si hay pendientes, el informe lo
  advierte.

## Pantalla _Atrasos_ (nueva, menú Operaciones)

Mismo patrón visual que _Justificaciones_: pestañas **Pendientes (n)** /
**Resueltos**, filtro por curso, búsqueda por alumno/RUT, paginación de 50.
Cada fila: casilla, alumno, RUT, curso, fecha. Acciones en lote sobre lo
seleccionado: **Marcar presente** / **Marcar ausente** (con confirmación que
indica cuántos). Visible para SUPER_ADMIN, DIRECTOR, UTP e INSPECTORIA.

## API

- `GET /attendance/late/school/:schoolId?state=pending|resolved&courseId&q&limit&offset`
- `POST /attendance/late/resolve { recordIds[] (1..200), status: PRESENT|ABSENT }`
  — valida que todos sigan pendientes y sean del colegio; todo o nada; auditoría
  con `attendanceChange` (cuenta para el respaldo por cambios). No notifica a
  apoderados.

## Fuera de alcance

Hora de corte automática (2ª hora), minutos de atraso en la UI, permitir o no que
el profesor marque `JUSTIFIED` directo (ya existe, se mantiene).
