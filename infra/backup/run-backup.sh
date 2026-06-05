#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PROJECT_DIR="$(cd "$DIR/../.." && pwd)"

LOCK_FILE="/tmp/run-backup.lock"
if [ -f "$LOCK_FILE" ]; then
  exit 0
fi
touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

if [ -f "$PROJECT_DIR/.env.prod" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env.prod" | xargs)
elif [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

USE_DOCKER_DB=false
if command -v docker >/dev/null 2>&1 && \
  [ "$(docker inspect -f '{{.State.Running}}' asistencia_db 2>/dev/null || echo false)" = "true" ]; then
  USE_DOCKER_DB=true
elif ! command -v mariadb >/dev/null 2>&1; then
  echo "[$(date)] No se encontro cliente MariaDB ni contenedor asistencia_db activo."
  exit 0
fi

db_query() {
  local sql="$1"
  local args=(-u "${DB_USER:-asistencia_app}" -r -N)
  if [ -n "${DB_PASSWORD:-}" ]; then
    args+=("-p${DB_PASSWORD}")
  fi
  args+=("${DB_NAME:-asistencia}" -e "$sql")

  if [ "$USE_DOCKER_DB" = "true" ]; then
    docker exec -i asistencia_db mariadb "${args[@]}"
  else
    mariadb -h "${DB_HOST:-db}" "${args[@]}"
  fi
}

db_dump() {
  local args=(-u "${DB_USER:-asistencia_app}")
  if [ -n "${DB_PASSWORD:-}" ]; then
    args+=("-p${DB_PASSWORD}")
  fi
  args+=("${DB_NAME:-asistencia}")

  if [ "$USE_DOCKER_DB" = "true" ]; then
    docker exec asistencia_db mariadb-dump "${args[@]}"
  else
    mariadb-dump -h "${DB_HOST:-db}" "${args[@]}"
  fi
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

get_setting() {
  local key
  key="$(sql_escape "$1")"
  db_query "SELECT value FROM system_settings WHERE \`key\` = '$key';" 2>/dev/null || true
}

upsert_setting() {
  local key value
  key="$(sql_escape "$1")"
  value="$(sql_escape "$2")"
  db_query "INSERT INTO system_settings (\`key\`, value, updatedAt) VALUES ('$key', '$value', NOW(3)) ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = NOW(3);"
}

DB_EMAILS="$(get_setting backup_emails)"
DB_TIME="$(get_setting backup_time)"
DB_PASS_ZIP="$(get_setting backup_password)"
DB_ACTIVE="$(get_setting backup_active)"
LAST_SUCCESS_AT="$(get_setting backup_last_success_at)"

BACKUP_EMAILS="${DB_EMAILS:-${BACKUP_EMAILS:-}}"
BACKUP_TIME="${DB_TIME:-${BACKUP_TIME_HHMM:-23:00}}"
BACKUP_PASS_ZIP="${DB_PASS_ZIP:-}"
BACKUP_ACTIVE="${DB_ACTIVE:-true}"

if [ "$BACKUP_ACTIVE" != "true" ]; then
  exit 0
fi

FORCE_RUN=false
for arg in "$@"; do
  if [ "$arg" = "force" ] || [ "$arg" = "--force" ]; then
    FORCE_RUN=true
  fi
done

if [ "$FORCE_RUN" = "false" ]; then
  CURRENT_LOCAL_TIME="$(TZ=America/Santiago date +%H:%M)"
  if [ "$CURRENT_LOCAL_TIME" != "$BACKUP_TIME" ]; then
    exit 0
  fi
fi

SINCE="${LAST_SUCCESS_AT:-1970-01-01 00:00:00}"
SINCE_SQL="$(sql_escape "$SINCE")"
CHANGE_COUNT_SQL="
SELECT COUNT(*)
FROM audit_events
WHERE entity = 'AttendanceRecord'
  AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.attendanceChange')) = 'true'
  AND JSON_LENGTH(JSON_EXTRACT(meta, '$.changes')) > 0
  AND createdAt > '$SINCE_SQL';
"

CHANGE_QUERY_FAILED=false
CHANGE_COUNT="$(db_query "$CHANGE_COUNT_SQL" 2>/dev/null | tail -n 1 | tr -d '\r' || true)"
case "$CHANGE_COUNT" in
  ''|*[!0-9]*)
    CHANGE_QUERY_FAILED=true
    CHANGE_COUNT=1
    ;;
esac

if [ "$FORCE_RUN" = "false" ] && [ "$CHANGE_COUNT" -eq 0 ]; then
  echo "[$(date)] Sin cambios de asistencia desde el ultimo backup exitoso. No se envia correo."
  exit 0
fi

BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"

DATE="$(date +%Y-%m-%d_%H%M%S)"
FILE_NAME="backup_asistencia_${DATE}.sql"
SQL_PATH="${BACKUP_DIR}/${FILE_NAME}"
ZIP_PATH="${SQL_PATH}.zip"

echo "[$(date)] Iniciando backup completo de la base de datos..."
db_dump > "$SQL_PATH"

if [ -n "$BACKUP_PASS_ZIP" ]; then
  SEVENZIP_BIN="$(command -v 7zz || command -v 7z || true)"
  if [ -z "$SEVENZIP_BIN" ]; then
    echo "[$(date)] Error: se requiere 7z/7zz para cifrado ZIP AES-256."
    exit 1
  fi
  echo "[$(date)] Cifrando ZIP con AES-256..."
  "$SEVENZIP_BIN" a -tzip -mem=AES256 -p"$BACKUP_PASS_ZIP" "$ZIP_PATH" "$SQL_PATH" >/dev/null
  rm -f "$SQL_PATH"
else
  echo "[$(date)] Comprimiendo ZIP sin cifrado..."
  zip -j -m "$ZIP_PATH" "$SQL_PATH" >/dev/null
fi

echo "[$(date)] Backup completado: $ZIP_PATH"

export BACKUP_EMAILS
export BACKUP_LAST_SUCCESS_AT="$LAST_SUCCESS_AT"
export BACKUP_CHANGE_COUNT="$CHANGE_COUNT"
export BACKUP_FORCE_RUN="$FORCE_RUN"
export BACKUP_USE_DOCKER_DB="$USE_DOCKER_DB"

node "$DIR/send-backup.mjs" "$ZIP_PATH"

if [ "$CHANGE_QUERY_FAILED" = "false" ]; then
  SUCCESS_AT="$(date -u '+%Y-%m-%d %H:%M:%S')"
  upsert_setting backup_last_success_at "$SUCCESS_AT"
  echo "[$(date)] Marcado ultimo backup exitoso: $SUCCESS_AT"
else
  echo "[$(date)] No se actualiza ultimo backup exitoso porque fallo la consulta de cambios."
fi

echo "[$(date)] Purgando backups locales antiguos..."
find "$BACKUP_DIR" -type f -name "backup_asistencia_*.sql.zip" -mtime +30 -delete

echo "[$(date)] Proceso de backup finalizado con exito."
