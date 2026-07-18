# Rango en "Agregar día especial" + franja de vacaciones solo con días hábiles

**Fecha:** 2026-07-18
**Estado:** Aprobado por el usuario en sesión
**Alcance:** Solo frontend (`apps/web`). Cero cambios de API, BD o datos. Reutiliza `POST /calendar` (un upsert por día).

## Problema

1. El formulario "Agregar día especial" del Calendario solo acepta un día a la
   vez. Cargar las vacaciones de invierno (19-jun→3-jul, 10 días hábiles) exige
   10 entradas manuales, y el upsert del backend puede **sobreescribir sin
   aviso** un día ya existente (ej. feriado 29-jun) si se ingresa esa fecha.
2. La franja informativa de vacaciones muestra el hueco entre semestres aunque
   sea solo fin de semana ("Vacaciones de invierno — 25 jul al 26 jul" con la
   config real S1→24-jul / S2 27-jul→), lo que confunde.

## Decisión

### A. Rango de fechas en el formulario

- El campo fecha pasa a "Desde"; se agrega "Hasta (opcional)".
- "Hasta" vacío → comportamiento actual intacto (un día, con opción de avisar
  a apoderados).
- Con rango: crea tipo+descripción para **cada día hábil** del rango,
  saltando automáticamente:
  - fines de semana,
  - fechas que **ya tienen entrada** en el año visible (no sobreescribe nada).
- Reglas de validación: `hasta >= desde`; rango dentro del **mismo año**
  (el mapa de días existentes se consulta por año); máximo **60 días**.
- En modo rango, "Avisar a apoderados" queda **deshabilitado y apagado**
  (evita N tandas de correos). `notify: false` en cada POST del rango.
- Resumen al guardar: «N días guardados · M omitidos (ya existían) · fines de
  semana excluidos»; si algún POST falla, toast warning con el conteo.
- Los POST del rango van **secuenciales** (orden estable, sin ráfaga).

### B. Franja de vacaciones solo si contiene días hábiles

`getVacationBanners` filtra las franjas cuyo rango no contiene ningún día
hábil (lun-vie). El estilo atenuado por celda (`getVacationInfo`) NO cambia —
el 25-26 jul siguen siendo celdas de fin de semana atenuadas.

## Lógica pura (patrón del proyecto: logic + spec Vitest)

En `calendar-vacations.logic.ts` (existente) se agrega:

```ts
export function isWeekendKey(dateKey: string): boolean; // getUTCDay ∈ {0,6}
```

y `getVacationBanners` retorna solo franjas con ≥1 día hábil.

Nuevo `apps/web/src/features/calendar/calendar-range.logic.ts`:

```ts
export type RangePlan =
  | { ok: true; create: string[]; skippedExisting: string[]; skippedWeekends: number }
  | { ok: false; error: 'INVALID_RANGE' | 'RANGE_TOO_LARGE' };

export function buildRangeDayKeys(
  from: string, // YYYY-MM-DD
  to: string, // YYYY-MM-DD
  existing: ReadonlySet<string>, // fechas con entrada en el año visible
): RangePlan;
```

- `to < from` o año distinto → `INVALID_RANGE`.
- Más de 60 días inclusivos → `RANGE_TOO_LARGE`.
- Itera con `shiftDateKey` (reutilizado de calendar-vacations.logic);
  weekend → `skippedWeekends++`; existente → `skippedExisting`; resto → `create`.

Caso de referencia (test obligatorio): `19-jun→3-jul-2026` con `{2026-06-29}`
existente → `create` = 19, 22, 23, 24, 25, 26, 30 jun + 1, 2, 3 jul (10),
`skippedExisting` = [29-jun], `skippedWeekends` = 4.

## Errores y bordes

- Rango inválido/muy grande → toast de error claro, sin ningún POST.
- Falla parcial a mitad del rango → los creados quedan (upsert idempotente:
  reintentar el mismo rango omite los ya creados), toast warning con conteo.
- `invalidateQueries(['calendar', schoolId])` una sola vez al final.
- Día único cae en fin de semana → se permite (comportamiento actual intacto).

## Despliegue

Igual que la feature anterior: commit → push → backup BD (protocolo) → rsync
archivos → build + restart SOLO servicio `web`. Autorizado por el usuario en
esta sesión (2026-07-18).
