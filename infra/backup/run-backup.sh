#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_DIR="$(cd "$DIR/../.." && pwd)"

# Load env variables
if [ -f "$PROJECT_DIR/.env.prod" ]; then
  # Load env, ignoring commented lines
  export $(grep -v '^#' "$PROJECT_DIR/.env.prod" | xargs)
elif [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Backup Configs
BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y-%m-%d)
FILE_NAME="backup_asistencia_${DATE}.sql"
SQL_PATH="${BACKUP_DIR}/${FILE_NAME}"
GZ_PATH="${SQL_PATH}.gz"

echo "[$(date)] Iniciando backup de la base de datos..."

# Dump database using docker exec
docker exec asistencia_db mariadb-dump -u "${DB_USER:-asistencia_app}" -p"${DB_PASSWORD}" "${DB_NAME:-asistencia}" > "$SQL_PATH"

# Compress
gzip -f "$SQL_PATH"

echo "[$(date)] Backup comprimido: $GZ_PATH"

# Send email
node "$DIR/send-backup.js" "$GZ_PATH"

# Purge backups older than 30 days
echo "[$(date)] Purgando backups de más de 30 días..."
find "$BACKUP_DIR" -type f -name "backup_asistencia_*.sql.gz" -mtime +30 -delete

echo "[$(date)] Proceso de backup finalizado."
