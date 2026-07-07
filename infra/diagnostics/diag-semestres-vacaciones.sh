#!/usr/bin/env bash
# =============================================================================
# diag-semestres-vacaciones.sh  ·  SOLO LECTURA / READ-ONLY
# -----------------------------------------------------------------------------
# Verifica el estado de la configuración de semestres y del calendario antes
# de aplicar la config 2026 (2º semestre desde el 6-jul). NO modifica datos.
#
# Uso (en el VPS):
#   bash infra/diagnostics/diag-semestres-vacaciones.sh
# =============================================================================
set -uo pipefail

DB=asistencia_db

line() { printf '\n=== %s ===\n' "$1"; }

dbq() {
  docker exec "$DB" sh -c \
    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" -t -e "$0"' "$1"
}

echo "######################################################################"
echo "#  DIAGNÓSTICO SEMESTRES/VACACIONES — SOLO LECTURA — $(date -u +%FT%TZ)"
echo "######################################################################"

line "1. Configuración de año escolar guardada (vacía = usa defaults 4-mar→18-jun / 1-jul→31-dic)"
dbq "SELECT schoolId, year, firstSemesterStart, firstSemesterEnd, secondSemesterStart, secondSemesterEnd, updatedAt FROM school_academic_year_configs;"

line "2. Días de calendario jun-jul 2026 (feriados/suspensiones registrados)"
dbq "SELECT date, type, description FROM school_calendar_days WHERE date BETWEEN '2026-06-01' AND '2026-07-31' ORDER BY date;"

line "3. Última asistencia del 1er semestre y primera del 2º (esperado: 18-jun y 6-jul)"
dbq "SELECT MAX(date) AS ultima_antes_vacaciones FROM attendance_records WHERE date <= '2026-07-05';"
dbq "SELECT MIN(date) AS primera_post_vacaciones FROM attendance_records WHERE date >= '2026-07-06';"

line "4. CONFLICTOS: asistencias fuera de los rangos objetivo [4-mar→18-jun] ∪ [6-jul→31-dic]"
echo "   (debe salir VACÍO; si hay filas, NO aplicar la config sin resolverlas)"
dbq "SELECT date, COUNT(*) AS registros FROM attendance_records WHERE date >= '2026-01-01' AND NOT (date BETWEEN '2026-03-04' AND '2026-06-18' OR date BETWEEN '2026-07-06' AND '2026-12-31') GROUP BY date ORDER BY date;"

line "5. Registros por día en la ventana 15-jun → hoy (sanidad general)"
dbq "SELECT date, COUNT(*) AS registros FROM attendance_records WHERE date >= '2026-06-15' GROUP BY date ORDER BY date;"

line "6. Fila 'Pueblos Indígenas' (histórico corrido: guardada 20-jun, real 21-jun; ambos fin de semana 2026 — informativo)"
dbq "SELECT id, date, type, description FROM school_calendar_days WHERE description LIKE '%Pueblos%';"

line "7. Reglas de alerta (bug form: triggers de días guardados como fracción, ej. 3 → 0.03)"
echo "   TEACHER_NO_RECORD / STUDENT_CONSECUTIVE_ABSENCES con threshold < 1 = fila corrupta a reparar"
dbq "SELECT * FROM alert_rules;"

echo
echo "Diagnóstico completo. Ningún dato fue modificado."
