# Migración a un VPS nuevo (sin perder información)

El respaldo es un **dump completo de toda la base de datos** (todas las tablas:
asistencia, alumnos, cursos, justificaciones, auditoría/movimientos, matrículas,
usuarios y roles, calendario, configuración e historial de migraciones Prisma)
**más la carpeta `uploads`** (justificaciones, avatares). Restaurarlo deja el
sistema idéntico, incluidas las cuentas para iniciar sesión.

> Para migrar, el método correcto es **restaurar por CLI** en el VPS nuevo: al
> estar la base vacía todavía no existe ningún usuario para entrar al panel.

## 1. En el VPS ACTUAL — generar el respaldo

- Panel → Configuración → Copias de Seguridad → **"Generar y descargar ahora"**
  (baja un `.zip` cifrado), y **copia la contraseña** del panel.
- O por CLI: `docker exec -e BACKUP_SKIP_SEND=true asistencia_api bash /app/infra/backup/run-backup.sh force`
  y toma el `.zip` más nuevo de `/opt/asistencia/backups/`.

Guarda **el `.zip` y la contraseña** (van por separado, nunca juntos).

## 2. En el VPS NUEVO — preparar el stack

```bash
# Docker + red compartida del proxy
docker network create caddy-shared   # si aplica

# Copiar el proyecto (incluye infra/ y .env.prod) desde tu equipo:
rsync -avz /ruta/local/Asistencia/ root@NUEVO_VPS:/opt/asistencia/
# (asegúrate de llevar .env.prod con DB_*, secretos, etc.)

cd /opt/asistencia
docker compose --env-file .env.prod -f infra/docker/docker-compose.prod.yml up -d db
docker compose --env-file .env.prod -f infra/docker/docker-compose.prod.yml build api web
```

## 3. Restaurar los datos

```bash
# Copia el .zip del respaldo al VPS nuevo, p.ej. /opt/asistencia/backups/
BACKUP_RESTORE_PASSWORD='la-contraseña-del-panel' \
  bash infra/backup/restore-backup.sh /opt/asistencia/backups/backup_asistencia_XXXX.zip
```

El script: (1) respalda la BD actual por seguridad, (2) extrae el `.zip` con la
contraseña, (3) importa toda la base (el dump trae `DROP TABLE` + `CREATE` +
datos, incluido `_prisma_migrations`), (4) restaura `uploads`.

> No hace falta `prisma migrate deploy` antes: el dump ya contiene el esquema
> completo y el historial de migraciones.

## 4. Levantar y verificar

```bash
docker compose --env-file .env.prod -f infra/docker/docker-compose.prod.yml up -d --no-deps api web
curl -fsS https://TU_DOMINIO/api/v1/health
```

- Inicia sesión con las **credenciales de siempre** (vinieron en el respaldo).
- Verifica conteos (alumnos, asistencia) en la app.

## 5. Corte de DNS

Apunta el dominio al VPS nuevo cuando todo esté verificado.

---

### Revertir una restauración

Antes de importar, el script deja un respaldo de seguridad en
`/opt/asistencia/backups/pre_restore_YYYYMMDD_HHMMSS.sql`. Para volver atrás:

```bash
bash infra/backup/restore-backup.sh /opt/asistencia/backups/pre_restore_XXXX.sql --force
```

### Notas

- Formatos aceptados por `restore-backup.sh`: `.zip` (cifrado AES-256), `.sql`, `.sql.gz`.
- Requiere `DB_ROOT_PASSWORD` en `.env.prod` y el contenedor `asistencia_db` arriba.
- Probado: backup → restore reproduce exactamente los conteos y conserva acentos/ñ.
