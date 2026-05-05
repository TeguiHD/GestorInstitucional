# Deploy — asistencia.nicoholas.dev

## Pre-requisitos VPS

```bash
# En el servidor (Ubuntu 22.04+)
apt update && apt install -y docker.io docker-compose-plugin certbot ufw

# Firewall
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP → redirect
ufw allow 443/tcp  # HTTPS
ufw enable

# SSH keys (NUNCA password root en prod)
# Agrega tu clave pública a ~/.ssh/authorized_keys
# Luego desactiva root password login:
sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart sshd
```

## 1. Certificado SSL

```bash
certbot certonly --standalone -d asistencia.nicoholas.dev
# Auto-renew:
echo "0 3 * * * certbot renew --quiet && docker exec asistencia_nginx nginx -s reload" >> /etc/crontab
```

## 2. Cloudflare DNS

```
Tipo: A
Nombre: asistencia
Valor: 45.55.214.153
Proxy: ☁️ ON (Cloudflare proxied)
TTL: Auto
```

Configurar en Cloudflare Dashboard → SSL/TLS → Full (strict).
WAF rules: habilitar OWASP Core Rule Set.

## 3. Deploy inicial

```bash
# En el servidor
mkdir -p /opt/asistencia && cd /opt/asistencia
git clone <repo> .
cp .env.example .env
# Editar .env con secretos reales (JWT secrets, DB passwords, etc.)
nano .env

# Levantar DB primero, ejecutar migrations + seed
docker compose -f infra/docker/docker-compose.prod.yml up -d db
docker compose -f infra/docker/docker-compose.prod.yml exec api sh -c \
  "pnpm --filter @asistencia/api prisma:deploy && pnpm --filter @asistencia/api db:seed"

# Levantar todo
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

## 4. Deploy de updates

```bash
cd /opt/asistencia
git pull
docker compose -f infra/docker/docker-compose.prod.yml build api web
docker compose -f infra/docker/docker-compose.prod.yml up -d --no-deps api web
docker compose -f infra/docker/docker-compose.prod.yml exec api \
  pnpm --filter @asistencia/api prisma:deploy
```

> Producción debe tener `_prisma_migrations` baselineada. Si se restaura una BD creada antes de Prisma migrations, crear backup, alinear columnas (`students.enrolledAt`) y registrar las migraciones aplicadas antes de ejecutar `prisma:deploy`.

## 5. Backups DB

```bash
# Dump diario (cron)
echo "0 2 * * * docker exec asistencia_db sh -c \
  'mysqldump -u root -p\$MARIADB_ROOT_PASSWORD asistencia | gzip > /backups/asistencia_\$(date +%Y%m%d).sql.gz'" \
  >> /etc/crontab

# Montar volumen backup:
docker run --rm -v asistencia_db_prod:/data -v /opt/backups:/backups alpine \
  tar czf /backups/db_vol_backup.tar.gz /data
```

## 6. Secrets checklist (ANTES del deploy)

- [ ] Rotar VPS root password → usar SSH keys exclusivamente
- [ ] Regenerar Cloudflare API token (minimal scope: Zone.DNS edit)
- [ ] Generar JWT_ACCESS_SECRET y JWT_REFRESH_SECRET (64 bytes random)
- [ ] Generar TOTP_ENC_KEY (`openssl rand -hex 32`)
- [ ] Generar DB_PASSWORD segura (32+ chars)
- [ ] Verificar que `.env.prod` y todo `.env.*` real estén fuera de git
- [ ] Configurar HIBP_ENABLED=true
- [ ] COOKIE_SECURE=true, COOKIE_SAMESITE=strict
- [ ] CORS_ORIGINS=https://asistencia.nicoholas.dev
- [ ] NODE_ENV=production
- [ ] `pnpm audit --prod` sin hallazgos critical/high
- [ ] SSH sin password y UFW activo con 22/80/443

## 7. Monitoreo

- Health check: `https://asistencia.nicoholas.dev/api/v1/health`
- Logs: `docker compose logs -f api`
- Audit log DB: `SELECT * FROM audit_events ORDER BY createdAt DESC LIMIT 50;`
