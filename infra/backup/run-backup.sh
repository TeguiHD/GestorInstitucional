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
    console.log(res.status);
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

assert_zip_archive() {
  local archive="$1"
  local password="${2:-}"

  if ! node - "$archive" <<'NODE' 2>"$LAST_ERROR_FILE"; then
const fs = require('fs');
const file = process.argv[2];
const fd = fs.openSync(file, 'r');
const header = Buffer.alloc(4);
fs.readSync(fd, header, 0, 4, 0);
fs.closeSync(fd);
if (header[0] !== 0x50 || header[1] !== 0x4b) {
  throw new Error('El archivo generado no tiene cabecera ZIP valida.');
}
NODE
    return 1
  fi

  if [ -n "$password" ]; then
    "$SEVENZIP_BIN" t -p"$password" "$archive" >/dev/null 2>"$LAST_ERROR_FILE"
  else
    zip -T "$archive" >/dev/null 2>"$LAST_ERROR_FILE"
  fi
}

validate_zip_password() {
  local password="$1"
  node - "$password" <<'NODE' 2>"$LAST_ERROR_FILE"
const password = process.argv[2] || '';
for (const char of password) {
  const code = char.codePointAt(0) || 0;
  if (code < 0x20 || code > 0x7e) {
    console.error(
      'La contrasena del backup contiene caracteres no compatibles con ZIP AES. Usa solo caracteres ASCII imprimibles.',
    );
    process.exit(1);
  }
}
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

# Carpeta de archivos subidos (justificaciones, avatares, documentos) para el
# respaldo COMPLETO del proyecto. Configurable; por defecto $PROJECT_DIR/uploads.
UPLOADS_DIR="${BACKUP_UPLOADS_DIR:-$PROJECT_DIR/uploads}"

DATE="$(date +%Y-%m-%d_%H%M%S)"
FILE_NAME="backup_asistencia_${DATE}.sql"
SQL_PATH="${BACKUP_DIR}/${FILE_NAME}"
# Con contraseña usamos .7z (AES-256 + cabecera cifrada; acepta CUALQUIER
# carácter, incluidos acentos/ñ — el ZIP-AES de 7-Zip falla con no-ASCII).
# Sin contraseña, .zip plano que abre Windows directo.
if [ -n "$BACKUP_PASS_ZIP" ]; then
  ARCHIVE_EXT="7z"
else
  ARCHIVE_EXT="zip"
fi
ZIP_PATH="${BACKUP_DIR}/backup_asistencia_${DATE}.${ARCHIVE_EXT}"

RUN_STARTED=true
ATTEMPT_AT="$(date -u '+%Y-%m-%d %H:%M:%S')"
upsert_setting backup_last_attempt_at "$ATTEMPT_AT"
upsert_setting backup_last_status running
upsert_setting backup_last_error ""

# Nota: se acepta cualquier contraseña. 7-Zip/WinRAR (requeridos para abrir un
# ZIP AES) manejan UTF-8; la contraseña se pasa siempre entre comillas dobles,
# por lo que su contenido no se reinterpreta en el shell.

echo "[$(date)] Iniciando backup completo de la base de datos..."
if ! db_dump > "$SQL_PATH" 2>"$LAST_ERROR_FILE"; then
  fail "mariadb-dump fallo; no se genero respaldo."
fi

if [ ! -s "$SQL_PATH" ]; then
  fail "mariadb-dump genero un archivo vacio."
fi

# Respaldo COMPLETO: incluye el dump SQL + la carpeta de uploads (si existe).
# Se referencian con rutas relativas a $PROJECT_DIR para una estructura limpia
# dentro del ZIP: "backups/<dump>.sql" y "uploads/...".
SQL_REL="${SQL_PATH#"$PROJECT_DIR"/}"
ARCHIVE_ITEMS=("$SQL_REL")
if [ -d "$UPLOADS_DIR" ]; then
  UPLOADS_REL="${UPLOADS_DIR#"$PROJECT_DIR"/}"
  ARCHIVE_ITEMS+=("$UPLOADS_REL")
  echo "[$(date)] Incluyendo uploads en el respaldo: $UPLOADS_DIR"
else
  echo "[$(date)] Sin carpeta de uploads ($UPLOADS_DIR); respaldo solo de base de datos."
fi

if [ -n "$BACKUP_PASS_ZIP" ]; then
  SEVENZIP_BIN="$(command -v 7zz || command -v 7z || true)"
  if [ -z "$SEVENZIP_BIN" ]; then
    fail "se requiere 7z/7zz para el respaldo cifrado AES-256."
  fi
  # AES-256 en el CONTENIDO (sin -mhe): la cabecera queda legible para que los
  # extractores estándar (GNOME Files/libarchive, macOS, etc.) pidan la clave.
  # Con -mhe=on GNOME falla: "archive header is encrypted, not supported".
  echo "[$(date)] Cifrando .7z (BD + archivos) con AES-256..."
  if ! ( cd "$PROJECT_DIR" && "$SEVENZIP_BIN" a -t7z -m0=lzma2 -p"$BACKUP_PASS_ZIP" "$ZIP_PATH" "${ARCHIVE_ITEMS[@]}" ) >/dev/null 2>"$LAST_ERROR_FILE"; then
    fail "7z fallo al crear el archivo cifrado AES-256."
  fi
  if ! "$SEVENZIP_BIN" t -p"$BACKUP_PASS_ZIP" "$ZIP_PATH" >/dev/null 2>"$LAST_ERROR_FILE"; then
    fail "el archivo cifrado generado no pudo validarse con la contrasena configurada."
  fi
  rm -f "$SQL_PATH"
else
  echo "[$(date)] Comprimiendo ZIP (BD + archivos) sin cifrado..."
  if ! ( cd "$PROJECT_DIR" && zip -r "$ZIP_PATH" "${ARCHIVE_ITEMS[@]}" ) >/dev/null 2>"$LAST_ERROR_FILE"; then
    fail "zip fallo al comprimir el respaldo."
  fi
  if ! assert_zip_archive "$ZIP_PATH"; then
    fail "el ZIP generado no pudo validarse."
  fi
  rm -f "$SQL_PATH"
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
DOWNLOAD_VERIFIED_AT=""
DOWNLOAD_VERIFIED_STATUS=""
DOWNLOAD_EXPIRES_AT="$(
  node -e "console.log(new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,19).replace('T',' '));"
)"

# Modo "Generar y descargar ahora": deja el respaldo listo para descarga directa
# desde el panel, SIN enviar correo ni generar enlace temporal.
if [ "${BACKUP_SKIP_SEND:-false}" = "true" ]; then
  SUCCESS_AT="$(date -u '+%Y-%m-%d %H:%M:%S')"
  upsert_setting backup_last_success_at "$SUCCESS_AT"
  upsert_setting backup_last_status success
  upsert_setting backup_last_error ""
  upsert_setting backup_last_message_id ""
  upsert_setting backup_last_delivery_mode "manual_download"
  upsert_setting backup_last_file_name "$(basename "$ZIP_PATH")"
  upsert_setting backup_last_file_size_bytes "$ZIP_SIZE_BYTES"
  upsert_setting backup_download_path "$ZIP_PATH"
  upsert_setting backup_download_file_name "$(basename "$ZIP_PATH")"
  upsert_setting backup_download_file_size_bytes "$ZIP_SIZE_BYTES"
  upsert_setting backup_download_expires_at "$DOWNLOAD_EXPIRES_AT"
  echo "[$(date)] Respaldo listo para descarga directa: $ZIP_PATH"
  exit 0
fi

# Se entrega por enlace seguro cuando: (a) supera el límite de adjunto, o
# (b) es .7z — Brevo rechaza adjuntar .7z ("Unsupported file format: 7z").
if [ "$ZIP_SIZE_BYTES" -gt "$ATTACHMENT_LIMIT_BYTES" ] || [ "$ARCHIVE_EXT" = "7z" ]; then
  if [ -z "$BACKUP_PASS_ZIP" ]; then
    fail "el ZIP pesa ${ZIP_SIZE_BYTES} bytes y supera el limite de adjunto; configura una contrasena para habilitar descarga segura."
  fi

  PUBLIC_BASE_URL="${BACKUP_PUBLIC_BASE_URL:-${API_PUBLIC_URL:-}}"
  if [ -z "$PUBLIC_BASE_URL" ]; then
    fail "BACKUP_PUBLIC_BASE_URL o API_PUBLIC_URL requerido para enviar respaldo grande por link."
  fi
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"

  # Token de 16 bytes (128-bit, hex=32 chars): URL mas corta para que los
  # clientes de correo no la partan en dos lineas (un token cortado da 404).
  IFS=$'\t' read -r DOWNLOAD_TOKEN DOWNLOAD_TOKEN_HASH DOWNLOAD_EXPIRES_AT < <(
    node -e "const crypto=require('crypto'); const token=crypto.randomBytes(16).toString('hex'); const hash=crypto.createHash('sha256').update(token).digest('hex'); const expires=new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,19).replace('T',' '); console.log([token,hash,expires].join('\t'));"
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
  if [ "$ARCHIVE_EXT" = "7z" ]; then
    echo "[$(date)] Respaldo .7z (${ZIP_SIZE_BYTES} bytes): Brevo no adjunta .7z, se enviara por link temporal."
  else
    echo "[$(date)] ZIP supera limite de adjunto (${ZIP_SIZE_BYTES} > ${ATTACHMENT_LIMIT_BYTES}); se enviara link temporal."
  fi
  echo "[$(date)] Verificando link temporal antes del envio..."
  if ! DOWNLOAD_VERIFIED_STATUS="$(verify_download_link "$DOWNLOAD_URL" 2>"$LAST_ERROR_FILE")"; then
    DOWNLOAD_VERIFIED_AT="$(date -u '+%Y-%m-%d %H:%M:%S')"
    upsert_setting backup_last_download_verified_at "$DOWNLOAD_VERIFIED_AT" 2>/dev/null || true
    upsert_setting backup_last_download_verified_status "${DOWNLOAD_VERIFIED_STATUS:-failed}" 2>/dev/null || true
    fail "el link temporal de descarga no responde correctamente."
  fi
  DOWNLOAD_VERIFIED_AT="$(date -u '+%Y-%m-%d %H:%M:%S')"
  upsert_setting backup_last_download_verified_at "$DOWNLOAD_VERIFIED_AT"
  upsert_setting backup_last_download_verified_status "$DOWNLOAD_VERIFIED_STATUS"
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
upsert_setting backup_last_download_verified_at "$DOWNLOAD_VERIFIED_AT"
upsert_setting backup_last_download_verified_status "$DOWNLOAD_VERIFIED_STATUS"
upsert_setting backup_download_token_hash "$DOWNLOAD_TOKEN_HASH"
upsert_setting backup_download_path "$ZIP_PATH"
upsert_setting backup_download_file_name "$(basename "$ZIP_PATH")"
upsert_setting backup_download_file_size_bytes "$ZIP_SIZE_BYTES"
upsert_setting backup_download_expires_at "$DOWNLOAD_EXPIRES_AT"
echo "[$(date)] Marcado ultimo backup exitoso: $SUCCESS_AT"

echo "[$(date)] Purgando backups locales antiguos..."
find "$BACKUP_DIR" -type f -name "backup_asistencia_*.sql.zip" -mtime +30 -delete

echo "[$(date)] Proceso de backup finalizado con exito."
