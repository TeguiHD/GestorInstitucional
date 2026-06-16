#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PROJECT_DIR="$(cd "$DIR/../.." && pwd)"

LOCK_DIR="/tmp/run-backup.lock"
LOCK_MAX_AGE_SECONDS="${BACKUP_LOCK_MAX_AGE_SECONDS:-21600}"

cleanup_lock() {
  rm -rf "$LOCK_DIR"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf "%s\n" "$$" > "$LOCK_DIR/pid"
    date +%s > "$LOCK_DIR/created_at"
    return 0
  fi

  local created_at now age
  created_at="$(cat "$LOCK_DIR/created_at" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  age=$((now - created_at))

  if [ "$created_at" -le 0 ] || [ "$age" -gt "$LOCK_MAX_AGE_SECONDS" ]; then
    echo "[$(date)] Lock de backup obsoleto detectado; se limpiara."
    rm -rf "$LOCK_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf "%s\n" "$$" > "$LOCK_DIR/pid"
      date +%s > "$LOCK_DIR/created_at"
      return 0
    fi
  fi

  echo "[$(date)] Backup ya en ejecucion. Lock: $LOCK_DIR"
  exit 75
}

acquire_lock
trap cleanup_lock EXIT

if [ -f "$PROJECT_DIR/.env.prod" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env.prod" | xargs)
elif [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

USE_DOCKER_DB=false
if command -v docker >/dev/null 2>&1 && \
  [ "$(docker inspect -f '{{.State.Running}}' asistencia_db 2>/dev/null || echo false)" = "true" ]; then
  USE_DOCKER_DB=true
elif ! command -v mariadb >/dev/null 2>&1 || ! command -v mariadb-dump >/dev/null 2>&1; then
  echo "[$(date)] No se encontro cliente MariaDB ni contenedor asistencia_db activo."
  exit 1
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

append_download_token() {
  local token_hash="$1"
  local file_path="$2"
  local file_name="$3"
  local file_size_bytes="$4"
  local expires_at="$5"
  local current next
  current="$(get_setting backup_download_tokens)"
  next="$(
    node - "$current" "$token_hash" "$file_path" "$file_name" "$file_size_bytes" "$expires_at" <<'NODE'
const [raw, tokenHash, filePath, fileName, fileSizeBytes, expiresAt] = process.argv.slice(2);
let list = [];
try {
  const parsed = raw ? JSON.parse(raw) : [];
  if (Array.isArray(parsed)) list = parsed;
} catch {}
const now = Date.now();
const next = list
  .filter((item) => item && typeof item === 'object')
  .filter((item) => {
    const expires = Date.parse(String(item.expiresAt || '').replace(' ', 'T') + 'Z');
    return Number.isFinite(expires) && expires > now;
  })
  .filter((item) => item.tokenHash !== tokenHash);
next.push({
  tokenHash,
  path: filePath,
  fileName,
  sizeBytes: Number(fileSizeBytes) || null,
  expiresAt,
});
console.log(JSON.stringify(next.slice(-20)));
NODE
  )"
  upsert_setting backup_download_tokens "$next"
}

verify_download_link() {
  local url="$1"
  node - "$url" <<'NODE'
const url = process.argv[2];
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15000);
fetch(url, { signal: controller.signal })
  .then((res) => {
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    res.body?.cancel?.();
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error(`Link de descarga no valido: ${error.message}`);
    process.exit(1);
  });
NODE
}

RUN_STARTED=false
LAST_ERROR_FILE="$(mktemp)"
SEND_RESULT_FILE="$(mktemp)"

fail() {
  local message="$1"
  echo "[$(date)] Error: $message" | tee -a "$LAST_ERROR_FILE" >&2
  exit 1
}

mark_failed_on_exit() {
  local code="$?"
  if [ "$RUN_STARTED" = "true" ] && [ "$code" -ne 0 ]; then
    local err
    err="$(tail -c 1000 "$LAST_ERROR_FILE" 2>/dev/null || true)"
    upsert_setting backup_last_status failed 2>/dev/null || true
    upsert_setting backup_last_error "${err:-Proceso de backup fallido con codigo $code}" 2>/dev/null || true
  fi
  if [ -n "${SQL_PATH:-}" ] && [ -f "$SQL_PATH" ]; then
    rm -f "$SQL_PATH"
  fi
  rm -f "$LAST_ERROR_FILE" "$SEND_RESULT_FILE"
  cleanup_lock
}

trap mark_failed_on_exit EXIT

if ! db_query "SELECT 1;" >/dev/null 2>"$LAST_ERROR_FILE"; then
  cat "$LAST_ERROR_FILE" >&2
  echo "[$(date)] No se pudo conectar a MariaDB para generar el respaldo." >&2
  exit 1
fi

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

BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"

DATE="$(date +%Y-%m-%d_%H%M%S)"
FILE_NAME="backup_asistencia_${DATE}.sql"
SQL_PATH="${BACKUP_DIR}/${FILE_NAME}"
ZIP_PATH="${SQL_PATH}.zip"
FORCE_DOWNLOAD_LINK=false

RUN_STARTED=true
ATTEMPT_AT="$(date -u '+%Y-%m-%d %H:%M:%S')"
upsert_setting backup_last_attempt_at "$ATTEMPT_AT"
upsert_setting backup_last_status running
upsert_setting backup_last_error ""
upsert_setting backup_last_message_id ""
upsert_setting backup_last_delivery_mode ""
upsert_setting backup_last_file_name ""
upsert_setting backup_last_file_size_bytes ""
upsert_setting backup_last_download_expires_at ""

echo "[$(date)] Iniciando backup completo de la base de datos..."
if ! db_dump > "$SQL_PATH" 2>"$LAST_ERROR_FILE"; then
  fail "mariadb-dump fallo; no se genero respaldo."
fi

if [ ! -s "$SQL_PATH" ]; then
  fail "mariadb-dump genero un archivo vacio."
fi

if [ -n "$BACKUP_PASS_ZIP" ]; then
  SEVENZIP_BIN="$(command -v 7zz || command -v 7z || true)"
  if [ -z "$SEVENZIP_BIN" ]; then
    fail "se requiere 7z/7zz para cifrado ZIP AES-256."
  fi
  echo "[$(date)] Cifrando ZIP con AES-256..."
  if ! "$SEVENZIP_BIN" a -tzip -mem=AES256 -p"$BACKUP_PASS_ZIP" "$ZIP_PATH" "$SQL_PATH" >/dev/null 2>"$LAST_ERROR_FILE"; then
    if grep -q "E_INVALIDARG" "$LAST_ERROR_FILE"; then
      FALLBACK_7Z_PATH="${SQL_PATH}.7z"
      rm -f "$ZIP_PATH" "$FALLBACK_7Z_PATH"
      echo "[$(date)] ZIP AES no acepto la contrasena; usando archivo 7z cifrado."
      if ! "$SEVENZIP_BIN" a -t7z -mhe=on -p"$BACKUP_PASS_ZIP" "$FALLBACK_7Z_PATH" "$SQL_PATH" >/dev/null 2>"$LAST_ERROR_FILE"; then
        fail "7z fallo al cifrar el respaldo en formato 7z."
      fi
      ZIP_PATH="$FALLBACK_7Z_PATH"
      FORCE_DOWNLOAD_LINK=true
    else
      fail "7z fallo al cifrar el respaldo."
    fi
  fi
  rm -f "$SQL_PATH"
else
  echo "[$(date)] Comprimiendo ZIP sin cifrado..."
  if ! zip -j -m "$ZIP_PATH" "$SQL_PATH" >/dev/null 2>"$LAST_ERROR_FILE"; then
    fail "zip fallo al comprimir el respaldo."
  fi
fi

if [ ! -s "$ZIP_PATH" ]; then
  fail "no se genero ZIP de respaldo."
fi
chmod 600 "$ZIP_PATH" 2>/dev/null || true

echo "[$(date)] Backup completado: $ZIP_PATH"

ZIP_SIZE_BYTES="$(wc -c < "$ZIP_PATH" | tr -d ' ')"
ATTACHMENT_LIMIT_BYTES="${BACKUP_ATTACHMENT_LIMIT_BYTES:-14680064}"
DELIVERY_MODE="attachment"
DOWNLOAD_URL=""
DOWNLOAD_TOKEN_HASH=""
DOWNLOAD_EXPIRES_AT="$(
  node -e "console.log(new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,19).replace('T',' '));"
)"

if [ "$ZIP_SIZE_BYTES" -gt "$ATTACHMENT_LIMIT_BYTES" ] || [ "$FORCE_DOWNLOAD_LINK" = "true" ]; then
  if [ -z "$BACKUP_PASS_ZIP" ]; then
    fail "el ZIP pesa ${ZIP_SIZE_BYTES} bytes y supera el limite de adjunto; configura una contrasena para habilitar descarga segura."
  fi

  PUBLIC_BASE_URL="${BACKUP_PUBLIC_BASE_URL:-${API_PUBLIC_URL:-}}"
  if [ -z "$PUBLIC_BASE_URL" ]; then
    fail "BACKUP_PUBLIC_BASE_URL o API_PUBLIC_URL requerido para enviar respaldo grande por link."
  fi
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"

  IFS=$'\t' read -r DOWNLOAD_TOKEN DOWNLOAD_TOKEN_HASH DOWNLOAD_EXPIRES_AT < <(
    node -e "const crypto=require('crypto'); const token=crypto.randomBytes(32).toString('base64url'); const hash=crypto.createHash('sha256').update(token).digest('hex'); const expires=new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,19).replace('T',' '); console.log([token,hash,expires].join('\t'));"
  )

  if [[ "$PUBLIC_BASE_URL" == */api/v1 ]]; then
    DOWNLOAD_URL="${PUBLIC_BASE_URL}/system-config/backup/download?token=${DOWNLOAD_TOKEN}"
  else
    DOWNLOAD_URL="${PUBLIC_BASE_URL}/api/v1/system-config/backup/download?token=${DOWNLOAD_TOKEN}"
  fi

  upsert_setting backup_download_token_hash "$DOWNLOAD_TOKEN_HASH"
  upsert_setting backup_download_path "$ZIP_PATH"
  upsert_setting backup_download_file_name "$(basename "$ZIP_PATH")"
  upsert_setting backup_download_file_size_bytes "$ZIP_SIZE_BYTES"
  upsert_setting backup_download_expires_at "$DOWNLOAD_EXPIRES_AT"
  append_download_token \
    "$DOWNLOAD_TOKEN_HASH" \
    "$ZIP_PATH" \
    "$(basename "$ZIP_PATH")" \
    "$ZIP_SIZE_BYTES" \
    "$DOWNLOAD_EXPIRES_AT"

  DELIVERY_MODE="download_link"
  if [ "$FORCE_DOWNLOAD_LINK" = "true" ]; then
    echo "[$(date)] Archivo cifrado requiere entrega por link temporal."
  else
    echo "[$(date)] ZIP supera limite de adjunto (${ZIP_SIZE_BYTES} > ${ATTACHMENT_LIMIT_BYTES}); se enviara link temporal."
  fi
  echo "[$(date)] Verificando link temporal antes del envio..."
  if ! verify_download_link "$DOWNLOAD_URL" 2>"$LAST_ERROR_FILE"; then
    fail "el link temporal de descarga no responde correctamente."
  fi
fi

export BACKUP_EMAILS
export BACKUP_LAST_SUCCESS_AT="$LAST_SUCCESS_AT"
export BACKUP_CHANGE_COUNT="$CHANGE_COUNT"
export BACKUP_FORCE_RUN="$FORCE_RUN"
export BACKUP_USE_DOCKER_DB="$USE_DOCKER_DB"
export BACKUP_DELIVERY_MODE="$DELIVERY_MODE"
export BACKUP_DOWNLOAD_URL="$DOWNLOAD_URL"
export BACKUP_DOWNLOAD_EXPIRES_AT="$DOWNLOAD_EXPIRES_AT"
export BACKUP_SEND_RESULT_FILE="$SEND_RESULT_FILE"

if ! node "$DIR/send-backup.mjs" "$ZIP_PATH" 2> >(tee "$LAST_ERROR_FILE" >&2); then
  fail "send-backup.mjs fallo; Brevo no confirmo el envio."
fi

IFS=$'\t' read -r MESSAGE_ID RESULT_DELIVERY_MODE RESULT_FILE_NAME RESULT_FILE_SIZE_BYTES RESULT_DOWNLOAD_EXPIRES_AT < <(
  node -e "const fs=require('fs'); const file=process.argv[1]; const data=JSON.parse(fs.readFileSync(file,'utf8')); if (!data.messageId) process.exit(2); console.log([data.messageId, data.deliveryMode || '', data.fileName || '', String(data.fileSizeBytes || ''), data.downloadExpiresAt || ''].join('\t'));" "$SEND_RESULT_FILE" 2>>"$LAST_ERROR_FILE"
) || fail "no se pudo leer confirmacion estructurada de Brevo."

if [ -z "$MESSAGE_ID" ]; then
  fail "Brevo no retorno messageId."
fi

SUCCESS_AT="$(date -u '+%Y-%m-%d %H:%M:%S')"
upsert_setting backup_last_success_at "$SUCCESS_AT"
upsert_setting backup_last_status success
upsert_setting backup_last_error ""
upsert_setting backup_last_message_id "$MESSAGE_ID"
upsert_setting backup_last_delivery_mode "$RESULT_DELIVERY_MODE"
upsert_setting backup_last_file_name "$RESULT_FILE_NAME"
upsert_setting backup_last_file_size_bytes "$RESULT_FILE_SIZE_BYTES"
upsert_setting backup_last_download_expires_at "$RESULT_DOWNLOAD_EXPIRES_AT"
upsert_setting backup_download_token_hash "$DOWNLOAD_TOKEN_HASH"
upsert_setting backup_download_path "$ZIP_PATH"
upsert_setting backup_download_file_name "$(basename "$ZIP_PATH")"
upsert_setting backup_download_file_size_bytes "$ZIP_SIZE_BYTES"
upsert_setting backup_download_expires_at "$DOWNLOAD_EXPIRES_AT"
echo "[$(date)] Marcado ultimo backup exitoso: $SUCCESS_AT"

echo "[$(date)] Purgando backups locales antiguos..."
find "$BACKUP_DIR" -type f \( -name "backup_asistencia_*.sql.zip" -o -name "backup_asistencia_*.sql.7z" \) -mtime +30 -delete

echo "[$(date)] Proceso de backup finalizado con exito."
