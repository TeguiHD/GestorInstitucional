# Calendario — "Receso de semestre" en huecos entre semestres que son puro fin de semana

**Fecha:** 2026-07-25
**Estado:** Aprobado
**Alcance:** Frontend-only (imagen `web`)

## Problema

En el Calendario, el día domingo 26-jul-2026 (y el sábado 25-jul) aparece atenuado con tooltip
"Vacaciones de invierno". Es confuso: la vacación de invierno real fue en junio (19-jun→3-jul,
cargada como días feriado explícitos). El 25-26 jul es solo el **fin de semana de cambio de
semestre** (S1 termina viernes 24-jul; S2 empieza lunes 27-jul).

**Causa:** `getVacationInfo` en `apps/web/src/features/calendar/calendar-vacations.logic.ts`
deriva "invierno" únicamente de "día estrictamente entre semestres", sin distinguir un receso
real (con días hábiles) de un finde de transición. La franja informativa ya oculta los huecos de
puro finde (`getVacationBanners` filtra con `rangeContainsWeekday`), pero las **celdas** no aplican
ese filtro → inconsistencia.

## Decisión

No ocultar el día (sigue siendo no lectivo y visible), sino **etiquetarlo con precisión**.

En la rama "invierno" de `getVacationInfo`, calcular los límites del hueco entre semestres y
reusar `rangeContainsWeekday`:

- Hueco **con al menos un día hábil** (receso real) → sigue `Vacaciones de invierno` (`kind: 'winter'`).
- Hueco **sin días hábiles** (puro finde de cambio de semestre) → `Receso de semestre`
  (`kind: 'recess'`).

**Sutileza:** el chequeo es sobre el **hueco completo**, no sobre el día. Un sábado _dentro_ de un
receso real de varias semanas sigue siendo "Vacaciones de invierno". Solo cambia cuando **todo** el
hueco es fin de semana.

## Cambios

`apps/web/src/features/calendar/calendar-vacations.logic.ts`:

- `VacationKind`: `'winter' | 'summer'` → `'winter' | 'summer' | 'recess'`.
- `LABELS`: agregar `recess: 'Receso de semestre'`.
- `getVacationInfo`: en la rama invierno, si `!rangeContainsWeekday(gapFrom, gapTo)` retornar recess;
  si no, winter. `gapFrom = shiftDateKey(firstSemester.endDate, 1)`,
  `gapTo = shiftDateKey(secondSemester.startDate, -1)`.

**Sin cambios** en `CalendarPage.tsx`: la celda ya muestra `vacation?.label` como tooltip y el gris
atenuado por truthiness (no estila por `kind`). La leyenda queda igual. Las franjas
(`getVacationBanners`) nunca emiten recess (ya filtran findes), así que el nuevo `kind` no las afecta.

## No incluido (fuera de alcance)

- **Backend** (`getOutOfPeriodDays` / `getNonSchoolDayDetails`): sigue etiquetando esos findes como
  "Vacaciones de invierno", pero son findes = no lectivos = **nunca aparecen** en reportes/grilla
  (que saltan días no lectivos). El label backend es invisible al usuario → no se toca. Si a futuro
  algún surface expone ese detalle, revisitar.
- No se agrega categoría a la leyenda ni color nuevo. Recess reusa el gris "Vacaciones".

## Tests (TDD)

`calendar-vacations.logic.spec.ts`, usando la config real de prod (`realCssp2026`:
S1 04-mar→24-jul, S2 27-jul→04-dic):

1. `getVacationInfo('2026-07-25', realCssp2026)` y `'2026-07-26'` → `{ kind: 'recess', label: 'Receso de semestre' }`.
2. Con `config2026` (hueco 19-jun→5-jul, con hábiles): `getVacationInfo('2026-06-19')` sigue `winter` (los 13 tests actuales quedan verdes).
3. Un finde dentro de un receso real con días hábiles sigue `winter` (ej. sábado dentro del hueco 19-jun→5-jul).

## Deploy (cuidadoso, web-only)

Hay otros proyectos con datos reales en el mismo VPS. Aislar:

1. Backup BD `asistencia` (por precaución, no se toca).
2. rsync solo archivos web cambiados a `/opt/asistencia/`, sin `--delete`.
3. `build web` (compose de asistencia).
4. `up -d --no-deps web` — solo recrea `asistencia_web`; no toca `api`, `db` ni otros contenedores.
5. Smoke: health + cargar Calendario, verificar 26-jul dice "Receso de semestre".

Sin migración (no toca BD).
