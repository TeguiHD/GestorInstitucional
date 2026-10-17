#!/usr/bin/env bash
#
# Trae el respaldo diario de asistencia.nicoholas.dev desde el VPS a esta máquina.
#
# Por qué existe: los respaldos se generan dentro del servidor, en el mismo disco
# que la base de datos. Si ese disco falla —o si Azure deshabilita la suscripción
# al agotarse el crédito— se pierden la base y sus copias a la vez. Este script
# es la única copia que vive fuera de Azure.
#
# Los .zip vienen cifrados con AES-256. La contraseña está en la tabla
# system_settings (clave `backup_password`) y se guarda aparte, nunca junto al
# respaldo.

set -euo pipefail

VPS_USER=teguihd
VPS_HOST=13.88.244.94
DESTINO="$HOME/Documentos/Paginas/backups-vps/asistencia"
LOG="$DESTINO/pull.log"

mkdir -p "$DESTINO"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

# El nombre del último respaldo lo decide el servidor, no esta máquina.
ULTIMO=$(ssh -o BatchMode=yes -o ConnectTimeout=20 "$VPS_USER@$VPS_HOST" \
  "docker exec asistencia_api sh -c 'ls -1t /app/backups/*.zip 2>/dev/null | head -1'" 2>/dev/null || true)

if [ -z "$ULTIMO" ]; then
  log "ERROR: no se encontró ningún respaldo en el servidor"
  exit 1
fi

NOMBRE=$(basename "$ULTIMO")

if [ -f "$DESTINO/$NOMBRE" ]; then
  log "sin novedad: $NOMBRE ya está descargado"
  exit 0
fi

# Se descarga a un temporal y se renombra al final: así un corte de red no deja
# un archivo a medias que parezca un respaldo válido.
TMP="$DESTINO/.$NOMBRE.parcial"
ssh -o BatchMode=yes -o ConnectTimeout=20 "$VPS_USER@$VPS_HOST" \
  "docker exec asistencia_api cat '$ULTIMO'" > "$TMP" 2>/dev/null

if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  log "ERROR: la descarga de $NOMBRE quedó vacía"
  exit 1
fi

# Cabecera ZIP ("PK") — descarta HTML de error o respuestas truncadas.
if [ "$(head -c 2 "$TMP")" != "PK" ]; then
  rm -f "$TMP"
  log "ERROR: $NOMBRE no tiene cabecera ZIP válida"
  exit 1
fi

mv "$TMP" "$DESTINO/$NOMBRE"
chmod 600 "$DESTINO/$NOMBRE"
TAM=$(du -h "$DESTINO/$NOMBRE" | cut -f1)
log "descargado: $NOMBRE ($TAM)"

# Retención por niveles, la misma que aplica el servidor
# (apps/api/src/system-config/backup-retention.ts): todos los de los últimos
# 14 días, el último de cada semana (8), de cada mes (24) y de cada año.
# Cada respaldo es completo, así que basta uno para restaurar. La carpeta
# archivo-previo-retencion/ no se toca nunca.
python3 - "$DESTINO" <<'PY' | while read -r viejo; do rm -f "$DESTINO/$viejo"; log "retención: eliminado $viejo"; done
import datetime as dt, os, re, sys
d = sys.argv[1]
rx = re.compile(r"^backup_asistencia_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.(zip|7z|sql)$")
files = []
for n in os.listdir(d):
    m = rx.match(n)
    if m:
        y, mo, da, h, mi, se = map(int, m.groups()[:6])
        files.append((dt.datetime(y, mo, da, h, mi, se, tzinfo=dt.timezone.utc), n))
files.sort(reverse=True)
if len(files) < 15:
    sys.exit(0)
now = dt.datetime.now(dt.timezone.utc)
keep = {n for t, n in files if now - t <= dt.timedelta(days=14)}
keep.add(files[0][1])
def newest(key, limit):
    seen = []
    for t, n in files:
        k = key(t)
        if k in seen:
            continue
        seen.append(k)
        keep.add(n)
        if len(seen) >= limit:
            break
newest(lambda t: t.isocalendar()[:2], 8)
newest(lambda t: (t.year, t.month), 24)
newest(lambda t: t.year, 10**9)
for t, n in files:
    if n not in keep:
        print(n)
PY

TOTAL=$(find "$DESTINO" -maxdepth 1 -name 'backup_asistencia_*.zip' | wc -l)
log "respaldos locales: $TOTAL"
