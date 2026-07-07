#!/usr/bin/env bash
# =============================================================================
# reparar-umbrales-alertas.sh — repara umbrales de alertas corruptos en prod
# -----------------------------------------------------------------------------
# Bug histórico del form web: TODO umbral se dividía por 100 al guardar, así
# que las reglas de conteo de días (TEACHER_NO_RECORD y
# STUDENT_CONSECUTIVE_ABSENCES) creadas por UI quedaron como fracción
# (ej. "3 días" → 0.03) y disparaban con cualquier ausencia.
#
# Este script multiplica de vuelta por 100 SOLO esas filas (threshold < 1 en
# triggers de días). Los triggers de porcentaje no se tocan.
#
# Uso (en el VPS): bash infra/ops/reparar-umbrales-alertas.sh
# Muestra las filas afectadas y pide confirmación antes de tocar nada.
# =============================================================================
set -euo pipefail

DB=asistencia_db

dbq() {
  docker exec "$DB" sh -c \
    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" -t -e "$0"' "$1"
}
dbq_raw() {
  docker exec "$DB" sh -c \
    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" -N -e "$0"' "$1"
}

WHERE="\`trigger\` IN ('STUDENT_CONSECUTIVE_ABSENCES','TEACHER_NO_RECORD') AND threshold IS NOT NULL AND threshold < 1"

echo "== Filas de alert_rules con umbral de días corrupto (fracción) =="
dbq "SELECT id, \`trigger\`, threshold, enabled FROM alert_rules WHERE $WHERE;"

COUNT=$(dbq_raw "SELECT COUNT(*) FROM alert_rules WHERE $WHERE;")
if [ "$COUNT" = "0" ]; then
  echo "Nada que reparar."
  exit 0
fi

read -r -p "¿Reparar $COUNT fila(s) multiplicando threshold x100? [escribe SI] " CONFIRM
if [ "$CONFIRM" != "SI" ]; then
  echo "Cancelado."
  exit 1
fi

dbq "UPDATE alert_rules SET threshold = ROUND(threshold * 100) WHERE $WHERE;"

echo "== Resultado =="
dbq "SELECT id, \`trigger\`, threshold, enabled FROM alert_rules;"
echo "Listo."
