# Vacaciones visibles en Calendario escolar

**Fecha:** 2026-07-18
**Estado:** Aprobado por el usuario (diseño conversado en sesión)
**Alcance:** Solo frontend (`apps/web`). Cero cambios de API, BD o datos de producción.

## Problema

La página Calendario escolar solo muestra los días especiales guardados en
`school_calendar_days` (feriados/suspendidos/eventos). Las vacaciones de
invierno y verano NO aparecen porque el sistema las deriva de la configuración
de semestres (`SchoolAcademicYearConfig`) de forma sintética — no se persisten
(decisión de diseño del backend, ver `calendar.service.ts:getOutOfPeriodDays`).

Resultado: la directora ve el 19-jun→3-jul "sin registrar" y cree que falta
arreglar la asistencia, cuando en realidad reportes, grilla, insights, alertas
y digest semanal ya excluyen esos días vía `calendar.getNonSchoolDays()`
(verificado en prod: lógica `isWinterGap` desplegada; 0 registros de
asistencia en 19-jun→5-jul).

## Decisión (aprobada)

Mostrar las vacaciones en la UI del Calendario derivándolas del endpoint ya
existente `GET /school-config/:schoolId/academic-year/:year`. NO insertar
filas por-día en `school_calendar_days` (duplicaría información y quedaría
obsoleta si cambian las fechas de semestres).

## Restricciones de seguridad (producción en uso diario)

- Sin cambios en `apps/api`, sin migraciones, sin escrituras a BD.
- Sin cambios de comportamiento en la asistencia ni reportes (solo visual).
- Si la query de config falla (rol sin acceso, red), la página degrada al
  comportamiento actual — sin toast de error, sin bloquear el render.
- Deploy: solo imagen `web` (build + restart), con backup previo por protocolo.

## Fuente de datos

Respuesta del endpoint (ya existente, accesible a cualquier usuario con
acceso al colegio):

```json
{
  "schoolId": "…", "year": 2026, "source": "saved" | "default",
  "firstSemester":  { "startDate": "2026-03-04", "endDate": "2026-06-18" },
  "secondSemester": { "startDate": "2026-07-06", "endDate": "2026-12-31" }
}
```

Query nueva en `CalendarPage` con `queryKey: ['academic-year', schoolId, year]`,
`staleTime` alto (config cambia rara vez), `enabled: !!schoolId`.

## Lógica derivada — `calendar-vacations.logic.ts`

Nuevo archivo en `apps/web/src/features/calendar/` (patrón del proyecto:
lógica pura extraída + spec, como `monthly-attendance-grid.logic.ts`).

```ts
type AcademicYearConfig = {
  firstSemester: { startDate: string; endDate: string };
  secondSemester: { startDate: string; endDate: string };
};
type VacationInfo = { kind: 'winter' | 'summer'; label: string } | null;

getVacationInfo(dateKey: string, config: AcademicYearConfig | undefined): VacationInfo
```

Reglas (comparación lexicográfica de strings `YYYY-MM-DD`, espejo exacto de
`calendar.service.ts:243-244` — cero aritmética de timezones):

- `config` ausente → `null`.
- **Invierno:** `dateKey > firstSemester.endDate && dateKey < secondSemester.startDate`
  → `{ kind: 'winter', label: 'Vacaciones de invierno' }` (2026: 19-jun→5-jul).
- **Verano:** `dateKey < firstSemester.startDate || dateKey > secondSemester.endDate`
  → `{ kind: 'summer', label: 'Vacaciones de verano' }` (2026: 01-ene→03-mar).
- Cualquier otro día → `null`.

Helper adicional para las franjas informativas (cubre invierno Y verano):

```ts
type VacationBanner = { kind: 'winter' | 'summer'; label: string;
                        from: string; to: string; returnDate: string | null };
getVacationBanners(year: number, config): VacationBanner[]
```

Retorna hasta 3 franjas del año calendario:

- **Verano inicio de año:** `{ from: '<year>-01-01', to: día anterior a
firstSemester.startDate, returnDate: firstSemester.startDate }` (si el
  inicio es posterior al 1-ene).
- **Invierno:** `{ from: día siguiente a firstSemester.endDate, to: día
anterior a secondSemester.startDate, returnDate:
secondSemester.startDate }` (si el gap no es vacío).
- **Verano fin de año:** `{ from: día siguiente a secondSemester.endDate,
to: '<year>-12-31', returnDate: null }` (si el fin es anterior al 31-dic;
  en 2026 no aplica porque termina el 31-dic).

La página muestra las franjas cuyo rango intersecta el mes visible.
(Suma/resta de días sobre `Date.UTC` + re-formateo, sin TZ local. Rango
vacío — `from > to` — se omite.)

## UI (lenguaje visual existente de CalendarPage)

1. **Celdas de la grilla mensual:** día con `getVacationInfo() !== null` y sin
   entrada explícita → fondo atenuado `bg-muted/60` + texto
   `text-muted-foreground/60`, `title` con el label. Sin puntito (reservado
   a días guardados). Un día explícito dentro de vacaciones (ej. feriado
   29-jun) mantiene su estilo y puntito: **lo explícito gana**, igual que el
   backend. El anillo de "hoy" se conserva.
2. **Leyenda:** ítem nuevo "Vacaciones" — swatch cuadrado `bg-muted` con
   borde, para diferenciarlo de los puntos de color (que denotan entradas).
3. **Franja informativa sobre la lista mensual:** visible cuando el mes
   intersecta el rango de invierno: «Vacaciones de invierno — 19 jun al
   5 jul · retorno lunes 6 jul», con subtítulo «según configuración de
   semestres». Estilo card `border-border bg-muted/30`, ícono lucide
   `TreePine`/`Snowflake`. Sin botones (no es entrada de BD: no se elimina,
   no se notifica). Para verano (enero/febrero/dic si aplica), franja
   equivalente con su rango.

## Errores y bordes

- Query de config en error o cargando → sin estilos de vacaciones (página
  idéntica a hoy). Nunca toast.
- Año sin config guardada → el endpoint devuelve defaults (`source:
'default'`) y la UI los muestra igual — mismo comportamiento que asistencia.
- Fines de semana dentro de vacaciones: se atenúan como vacaciones (ya se
  atenúan hoy por ser weekend; el `title` agrega el label).
- Cambio de año en el selector → la query depende de `year`, se refresca sola.

## Tests

`calendar-vacations.logic.spec.ts` (Vitest, patrón de specs existentes):

- Bordes invierno: 18-jun → null; 19-jun → winter; 05-jul → winter; 06-jul → null.
- Verano: 15-ene → summer; 04-mar → null; 03-mar → summer (día antes de inicio).
- Config undefined → null.
- `getVacationBanners(2026, config)`: incluye verano
  { from: 2026-01-01, to: 2026-03-03, returnDate: 2026-03-04 } e invierno
  { from: 2026-06-19, to: 2026-07-05, returnDate: 2026-07-06 }; NO incluye
  verano fin de año (semestre 2 termina 31-dic). Gap invierno vacío
  (semestres contiguos) → sin franja de invierno.
- Cruce de año/mes en resta de días (endDate fin de mes) → fecha correcta.

Verificación manual post-implementación: `pnpm --filter web test`,
`typecheck`, `lint`, y revisión visual local (junio y julio 2026, y enero
para verano) antes de cualquier deploy.

## Despliegue

1. Commit + push a `main`.
2. Backup DB en VPS (protocolo estándar, aunque no se toca la BD).
3. `rsync` archivos cambiados (solo `apps/web/src/...`, sin `--delete`).
4. Build imagen `web` + `up -d --no-deps web`. La API y la BD no se tocan.
5. Smoke test: login y revisión del calendario en junio/julio 2026.

## Fuera de alcance

- Mostrar vacaciones en la leyenda de la grilla de asistencia mensual
  (hoy dice "Feriado" genérico) — mejora aparte si la clienta la pide.
- UI para editar fechas de semestres (existe vía API, solo SUPER_ADMIN).
- Acción "deshacer retiro" en pestaña Retirados (pendiente de otra sesión).
