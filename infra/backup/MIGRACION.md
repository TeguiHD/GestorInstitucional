# Migración a un VPS nuevo (sin perder información)

Probado el 17-oct-2026 con el ZIP que llega por correo: restauración idéntica a
producción (398 alumnos, 54.294 registros de asistencia, mismo checksum).

## Qué necesitas (y dónde está)

| Pieza         | Dónde                                                                      | Notas                                                                                |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Código        | este repo, rama `main`                                                     | Es exactamente lo que corre en producción.                                           |
| Datos         | cualquier respaldo `backup_asistencia_*.zip` (correo, panel o copia local) | Cada uno es **completo**: base de datos + `uploads`.                                 |
| Clave del ZIP | Configuración → Copias de seguridad (botón ojo / Copiar)                   | AES-256: sin la clave el ZIP no se abre.                                             |
| `.env.prod`   | gestor de contraseñas / copia local, **nunca en el repo**                  | Imprescindible `TOTP_ENC_KEY` (sin ella se pierde el 2FA de todos) y `FILE_ENC_KEY`. |

Los respaldos se conservan por niveles (14 días completos, 1 por semana × 8, 1
por mes × 24, 1 por año): ver `apps/api/src/system-config/backup-retention.ts`.
Para migrar se usa **el más reciente**; la auditoría que lleva dentro conserva
el historial completo de cambios.

## 1. VPS nuevo: código y configuración

```bash
git clone git@github.com:TeguiHD/GestorInstitucional.git /opt/asistencia
cd /opt/asistencia
cp /ruta/segura/.env.prod .env.prod            # el mismo de producción
# Compose: infra/docker/docker-compose.azure.yml (servidor chico, imágenes
# precompiladas) o infra/docker/docker-compose.prod.yml (servidor que compila).
```

Si cambia el nombre del servicio de base de datos o la red del proxy, ajusta
`DB_HOST` y `DATABASE_URL` en `.env.prod` (ver `infra/docs/deploy.md`).

## 2. Levantar solo la base de datos

```bash
docker compose --env-file .env.prod -f <compose> up -d asistencia-db   # (db en el compose del droplet)
```

## 3. Restaurar el respaldo

```bash
mkdir -p backups && cp /ruta/backup_asistencia_AAAA-MM-DD_HHMMSS.zip backups/
BACKUP_RESTORE_PASSWORD='la-clave-del-panel' \
  bash infra/backup/restore-backup.sh backups/backup_asistencia_AAAA-MM-DD_HHMMSS.zip
```

El script respalda primero lo que haya en la base (`backups/pre_restore_*.sql`),
descifra el ZIP, importa toda la base (esquema, datos, usuarios, historial de
migraciones) y restaura `uploads`. Requiere `7z` en el host y el contenedor
`asistencia_db` en marcha.

## 4. Levantar la app y aplicar migraciones pendientes

El respaldo puede ser más antiguo que el código: aplica las migraciones que le
falten (si no falta ninguna, no hace nada).

```bash
docker compose --env-file .env.prod -f <compose> up -d api web
docker compose --env-file .env.prod -f <compose> run --rm --entrypoint sh api \
  -c "cd apps/api && ./node_modules/.bin/prisma migrate deploy"
curl -fsS https://TU_DOMINIO/api/v1/health
```

Inicia sesión con las cuentas de siempre (vienen en el respaldo).

## 5. Corte

- Cloudflare → DNS → registro A del dominio → IP nueva.
- Brevo → https://app.brevo.com/security/authorised_ips → agregar la IP nueva
  (sin esto no sale ningún correo, ni los respaldos).

## Revertir una restauración

```bash
bash infra/backup/restore-backup.sh backups/pre_restore_AAAAMMDD_HHMMSS.sql --force
```

## Copia fuera del servidor

`infra/backup/pull-backup-local.sh` descarga cada día el respaldo más reciente
a un equipo propio (temporizador systemd de usuario) y aplica la misma
retención por niveles. Es la copia que sobrevive si el servidor se pierde.
