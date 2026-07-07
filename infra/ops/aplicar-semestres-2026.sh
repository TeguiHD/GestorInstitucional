#!/usr/bin/env bash
# =============================================================================
# aplicar-semestres-2026.sh — configura el año escolar 2026 del CSSP en prod
# -----------------------------------------------------------------------------
# 1er semestre: 2026-03-04 → 2026-06-18   (último día de clases antes de
#                                          las vacaciones de invierno)
# 2º semestre:  2026-07-06 → 2026-12-31   (inicio real del 2º semestre; el
#                                          término puede ajustarse después
#                                          desde Configuración con superadmin)
#
# Con esta fila + el código desplegado, el 19-jun→5-jul queda como
# "Vacaciones de invierno" en toda la app (banner de pendientes, grilla,
# %, reportes, alertas).
#
# Seguridad:
#  - Corre primero el chequeo de conflictos (asistencias fuera de rango) y
#    ABORTA si encuentra alguna (misma validación que aplica la API).
#  - Exige respaldo previo: pásale la ruta con --backup-hecho <archivo.sql>.
#  - Upsert idempotente (UNIQUE schoolId+year).
#
# Uso (en el VPS):
#   bash infra/ops/aplicar-semestres-2026.sh --backup-hecho /opt/asistencia/backups/asistencia_YYYYMMDD_pre_semestres2026.sql
# =============================================================================
set -euo pipefail

DB=asistencia_db
SCHOOL_ID='4abc8265-3d1e-11f1-afe3-225b7c7f0a14'   # Colegio San Sebastián de Paine
S1_START='2026-03-04'
S1_END='2026-06-18'
S2_START='2026-07-06'
S2_END='2026-12-31'

BACKUP_FILE=""
if [ "${1:-}" = "--backup-hecho" ] && [ -n "${2:-}" ]; then
  BACKUP_FILE="$2"
fi
if [ -z "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
  echo "ABORTADO: primero genera un respaldo y pásalo con --backup-hecho <archivo.sql>." >&2
  echo 'Ej: BACKUP="/opt/asistencia/backups/asistencia_$(date +%Y%m%d_%H%M%S)_pre_semestres2026.sql"' >&2
  echo '    docker exec asistencia_db sh -c "mariadb-dump --single-transaction --quick --routines --triggers -u root -p\$MARIADB_ROOT_PASSWORD asistencia" > "$BACKUP"' >&2
  exit 1
fi

dbq() {
  docker exec "$DB" sh -c \
    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" -N -e "$0"' "$1"
}

echo "== Chequeo de conflictos: asistencias fuera de [$S1_START→$S1_END] ∪ [$S2_START→$S2_END] =="
CONFLICTS=$(dbq "SELECT COUNT(*) FROM attendance_records WHERE date >= '2026-01-01' AND NOT (date BETWEEN '$S1_START' AND '$S1_END' OR date BETWEEN '$S2_START' AND '$S2_END');")
if [ "$CONFLICTS" != "0" ]; then
  echo "ABORTADO: hay $CONFLICTS registros de asistencia fuera de los semestres objetivo." >&2
  echo "Detalle:" >&2
  dbq "SELECT date, COUNT(*) FROM attendance_records WHERE date >= '2026-01-01' AND NOT (date BETWEEN '$S1_START' AND '$S1_END' OR date BETWEEN '$S2_START' AND '$S2_END') GROUP BY date ORDER BY date;" >&2
  exit 1
fi
echo "OK: sin conflictos."

echo "== Aplicando configuración 2026 (upsert idempotente) =="
dbq "INSERT INTO school_academic_year_configs
      (id, schoolId, year, firstSemesterStart, firstSemesterEnd, secondSemesterStart, secondSemesterEnd, createdAt, updatedAt)
     VALUES
      (UUID(), '$SCHOOL_ID', 2026, '$S1_START', '$S1_END', '$S2_START', '$S2_END', NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
      firstSemesterStart='$S1_START', firstSemesterEnd='$S1_END',
      secondSemesterStart='$S2_START', secondSemesterEnd='$S2_END', updatedAt=NOW(3);"

echo "== Resultado =="
docker exec "$DB" sh -c \
  'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" -t -e "SELECT year, firstSemesterStart, firstSemesterEnd, secondSemesterStart, secondSemesterEnd, updatedAt FROM school_academic_year_configs WHERE year=2026;"'

echo "Listo. Verifica en la app que el banner de asistencia pendiente ya no cuenta las vacaciones."
