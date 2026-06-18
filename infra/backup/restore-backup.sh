#!/usr/bin/env bash
# =============================================================================
# restore-backup.sh — Restaura un respaldo a la base de datos + uploads.
#
#   ⚠️  OPERACIÓN DESTRUCTIVA: REEMPLAZA los datos actuales por los del respaldo.
#       Pensada para MIGRAR de VPS o recuperar ante un desastre, sin perder info.
#
# Uso (en el VPS destino, dentro de /opt/asistencia):
#   BACKUP_RESTORE_PASSWORD='tu-clave' bash infra/backup/restore-backup.sh <archivo> [--force]
#
#   <archivo>: el respaldo .zip cifrado (AES-256), un .sql o un .sql.gz.
#   --force  : omite la confirmación interactiva (para scripts).
#
# Pasos: valida → respalda la BD actual → extrae → importa SQL → restaura uploads.
# Requiere: contenedor asistencia_db en marcha, .env.prod con DB_ROOT_PASSWORD,
#           y 7z/7zz si el respaldo es .zip cifrado.
# =============================================================================
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PROJECT_DIR="$(cd "$DIR/../.." && pwd)"

ARCHIVE=""
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    *) [ -z "$ARCHIVE" ] && ARCHIVE="$arg" ;;
  esac
done

if [ -z "$ARCHIVE" ]; then
  echo "Uso: BACKUP_RESTORE_PASSWORD=... bash $0 <archivo .zip|.sql|.sql.gz> [--force]"
  exit 1
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "No existe el archivo: $ARCHIVE"
  exit 1
fi

# Credenciales desde el entorno del proyecto.
if [ -f "$PROJECT_DIR/.env.prod" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env.prod"
  set +a
elif [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi

DB_NAME="${DB_NAME:-asistencia}"
ROOT_PW="${DB_ROOT_PASSWORD:-}"
if [ -z "$ROOT_PW" ]; then
  echo "Falta DB_ROOT_PASSWORD en .env.prod (se requiere para restaurar)."
  exit 1
fi

USE_DOCKER_DB=false
if command -v docker >/dev/null 2>&1 &&
  [ "$(docker inspect -f '{{.State.Running}}' asistencia_db 2>/dev/null || echo false)" = "true" ]; then
  USE_DOCKER_DB=true
fi

db_import() { # SQL por stdin -> base como root
  if [ "$USE_DOCKER_DB" = true ]; then
    docker exec -i asistencia_db mariadb -uroot -p"$ROOT_PW" "$DB_NAME"
  else
    mariadb -h "${DB_HOST:-127.0.0.1}" -uroot -p"$ROOT_PW" "$DB_NAME"
  fi
}

db_dump_root() { # dump de seguridad como root
  local args=(-uroot -p"$ROOT_PW" --single-transaction --quick --default-character-set=utf8mb4 "$DB_NAME")
  if [ "$USE_DOCKER_DB" = true ]; then
    docker exec asistencia_db mariadb-dump "${args[@]}"
  else
    mariadb-dump -h "${DB_HOST:-127.0.0.1}" "${args[@]}"
  fi
}

if [ "$FORCE" != true ]; then
  echo "⚠️  RESTAURACIÓN DESTRUCTIVA"
  echo "    Archivo : $ARCHIVE"
  echo "    Base    : $DB_NAME  (sus datos actuales serán REEMPLAZADOS)"
  printf "Escribe RESTAURAR para continuar: "
  read -r ANSWER
  if [ "$ANSWER" != "RESTAURAR" ]; then
    echo "Cancelado."
    exit 1
  fi
fi

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# 1) Respaldo de seguridad de la BD actual (por si hay que revertir).
mkdir -p "$PROJECT_DIR/backups"
SAFETY="$PROJECT_DIR/backups/pre_restore_$(date +%Y%m%d_%H%M%S).sql"
echo "[1/4] Respaldo de seguridad de la BD actual → $SAFETY"
if ! db_dump_root >"$SAFETY" 2>/dev/null; then
  echo "      No se pudo respaldar la BD actual; abortando por seguridad."
  exit 1
fi

# 2) Obtener el dump SQL (y uploads si vienen) del respaldo.
SQL_FILE=""
UPLOADS_SRC=""
case "$ARCHIVE" in
  *.zip)
    SZ="$(command -v 7zz || command -v 7z || true)"
    if [ -z "$SZ" ]; then
      echo "      Se requiere 7z/7zz para extraer un .zip cifrado."
      exit 1
    fi
    echo "[2/4] Extrayendo $ARCHIVE …"
    if [ -n "${BACKUP_RESTORE_PASSWORD:-}" ]; then
      if ! "$SZ" x -p"$BACKUP_RESTORE_PASSWORD" -o"$WORK" "$ARCHIVE" >/dev/null 2>&1; then
        echo "      Fallo al extraer (¿contraseña incorrecta?)."
        exit 1
      fi
    else
      if ! "$SZ" x -o"$WORK" "$ARCHIVE" >/dev/null 2>&1; then
        echo "      Fallo al extraer. Si está cifrado, usa BACKUP_RESTORE_PASSWORD=..."
        exit 1
      fi
    fi
    SQL_FILE="$(find "$WORK" -type f -name '*.sql' | head -1)"
    UPLOADS_SRC="$(find "$WORK" -type d -name uploads | head -1)"
    ;;
  *.sql.gz | *.gz)
    echo "[2/4] Descomprimiendo $ARCHIVE …"
    gunzip -c "$ARCHIVE" >"$WORK/dump.sql"
    SQL_FILE="$WORK/dump.sql"
    ;;
  *.sql)
    SQL_FILE="$ARCHIVE"
    ;;
  *)
    echo "      Formato no soportado: $ARCHIVE (usa .zip, .sql o .sql.gz)"
    exit 1
    ;;
esac

if [ -z "$SQL_FILE" ] || [ ! -s "$SQL_FILE" ]; then
  echo "      No se encontró un dump SQL dentro del respaldo."
  exit 1
fi

# 3) Importar la base (el dump incluye DROP TABLE + CREATE + datos).
echo "[3/4] Importando base de datos en '$DB_NAME' …"
if ! db_import <"$SQL_FILE"; then
  echo "      Fallo la importación. Restaura el estado previo con:"
  echo "      bash $0 $SAFETY --force"
  exit 1
fi

# 4) Restaurar uploads si el respaldo los incluye.
if [ -n "$UPLOADS_SRC" ] && [ -d "$UPLOADS_SRC" ] && [ -n "$(ls -A "$UPLOADS_SRC" 2>/dev/null)" ]; then
  echo "[4/4] Restaurando uploads …"
  if [ "$USE_DOCKER_DB" = true ]; then
    docker exec asistencia_api sh -c 'mkdir -p /app/uploads' 2>/dev/null || true
    if docker cp "$UPLOADS_SRC/." asistencia_api:/app/uploads/ 2>/dev/null; then
      docker exec asistencia_api sh -c 'chown -R appuser:nodejs /app/uploads' 2>/dev/null || true
    else
      echo "      No se pudo copiar uploads al contenedor; cópialos manualmente desde $UPLOADS_SRC"
    fi
  else
    mkdir -p "$PROJECT_DIR/uploads"
    cp -a "$UPLOADS_SRC/." "$PROJECT_DIR/uploads/"
  fi
else
  echo "[4/4] El respaldo no incluye uploads (o está vacío); se omite."
fi

echo ""
echo "✅ Restauración completa en '$DB_NAME'."
echo "   Respaldo de seguridad previo: $SAFETY"
echo "   Reinicia la API para limpiar conexiones/caché:"
echo "   docker compose --env-file .env.prod -f infra/docker/docker-compose.prod.yml up -d --no-deps api"
