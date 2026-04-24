<div align="center">

# 🏫 Gestor Institucional

### Sistema de Gestión Escolar · Asistencia & Administración Académica

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![MariaDB](https://img.shields.io/badge/MariaDB-11-003545?style=flat-square&logo=mariadb&logoColor=white)](https://mariadb.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/Licencia-MIT-22c55e?style=flat-square)](LICENSE)

**Plataforma privada y multi-tenant para gestión de asistencia escolar, comunicaciones con apoderados, reportes MINEDUC y administración académica.**

[✨ Demo en vivo](https://asistencia.nicoholas.dev) · [📖 API Docs](https://asistencia.nicoholas.dev/docs) · [🐛 Reportar bug](https://github.com/TeguiHD/GestorInstitucional/issues)

</div>

---

## 📋 Tabla de Contenidos

- [¿Qué problema resuelve?](#-qué-problema-resuelve)
- [Funcionalidades](#-funcionalidades)
- [Stack Tecnológico](#-stack-tecnológico)
- [Arquitectura](#-arquitectura)
- [Seguridad](#-seguridad)
- [Inicio Rápido](#-inicio-rápido)
- [Variables de Entorno](#-variables-de-entorno)
- [Scripts disponibles](#-scripts-disponibles)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Modelos de datos](#-modelos-de-datos)
- [API Reference](#-api-reference)
- [Roles y permisos](#-roles-y-permisos)
- [Escalabilidad multi-tenant](#-escalabilidad-multi-tenant)
- [Roadmap](#-roadmap)

---

## 🎯 ¿Qué problema resuelve?

Los colegios en Chile manejan la asistencia con planillas Excel, WhatsApp a apoderados y reportes manuales para el MINEDUC (SIGE). Esto genera:

| Problema                             | Impacto                                   |
| ------------------------------------ | ----------------------------------------- |
| Registro manual por planilla         | Errores, pérdida de datos, horas perdidas |
| Sin trazabilidad de justificaciones  | Conflictos con apoderados                 |
| Reportes SIGE generados a mano       | Trabajo administrativo innecesario        |
| Sin alertas tempranas de ausentismo  | Detección tardía de problemas             |
| Sin historial académico centralizado | Transferencias y egreso complicados       |

**Gestor Institucional** digitaliza y automatiza todo el ciclo: registro → alertas → comunicación → reporte. Diseñado como producto SaaS vendible a múltiples establecimientos educacionales.

---

## ✨ Funcionalidades

### 📊 Gestión de Asistencia

- ✅ Registro diario por curso en un solo clic (operación **bulk idempotente**)
- ✅ Estados: **Presente**, **Ausente**, **Tarde** (con minutos), **Justificado**, **Retirado**
- ✅ Historial completo alumno × día con filtros por período (semana, mes, semestre, año)
- ✅ Matriz visual alumno × día del mes
- ✅ Detección automática de **patrones de ausencias** por día de la semana

### 📁 Reportes Exportables

- ✅ **Excel mensual** con formato profesional (ExcelJS)
- ✅ **PDF mensual** con encabezado y firma (PDFKit)
- ✅ **Grilla SIGE MINEDUC** — formato oficial, landscape A4
- ✅ Reporte **semanal** y **semestral** en Excel
- ✅ Estadísticas globales por escuela para dashboard

### 👥 Gestión Académica

- ✅ Cursos con profesor jefe y múltiples docentes asignados
- ✅ Asignaturas **por curso** — una misma asignatura puede tener distinto docente en 1°A y en 2°B
- ✅ Calificaciones por período (P1, P2, E1, P3, P4, E2, Nota Final)
- ✅ Horarios académicos (día × bloque × hora)
- ✅ Historial completo de matrícula (matrícula, retiro, transferencia, reingreso)
- ✅ **Importación masiva de alumnos via CSV** con validación de RUT chileno (módulo 11)

### 🔔 Alertas & Comunicaciones

- ✅ Reglas de alerta configurables por umbral (ej: "avisar cuando asistencia < 85%")
- ✅ Triggers: alumno bajo umbral, promedio curso, **faltas consecutivas**, docente sin registros
- ✅ Cola de correos asíncrona con reintentos (integración **Brevo**)
- ✅ **SMS con Twilio** para notificaciones críticas
- ✅ Notificaciones push en plataforma
- ✅ Categorías: ausencia diaria, resultado justificación, resumen semanal, suspensión de clases

### 📅 Calendario Escolar

- ✅ Feriados, suspensiones y eventos institucionales
- ✅ Días hábiles automáticos (excluye fines de semana y festivos)

### 🏛️ Portal del Apoderado

- ✅ Vista personal de asistencia de sus pupilos
- ✅ Carga y seguimiento de justificaciones con documentos adjuntos
- ✅ Workflow de aprobación: **PENDIENTE → APROBADO / RECHAZADO**

### 🔍 Auditoría Inmutable

- ✅ Log de todas las acciones (CREATE, UPDATE, DELETE, LOGIN, EXPORT…)
- ✅ **Hash chain SHA-256** por registro — detección de tampering
- ✅ Metadatos JSON: IP, user-agent, diff de cambios

---

## 🛠 Stack Tecnológico

### Frontend

| Tecnología          | Versión | Uso                             |
| ------------------- | ------- | ------------------------------- |
| **React**           | 19      | UI reactiva                     |
| **TypeScript**      | 5.6     | Tipado estático                 |
| **Vite**            | 5.4     | Bundler ultrarrápido + PWA      |
| **TanStack Router** | 1.73    | Routing file-based, type-safe   |
| **TanStack Query**  | 5.59    | Data fetching & cache           |
| **Tailwind CSS**    | 4       | Utility-first styling           |
| **Radix UI**        | latest  | Componentes headless accesibles |
| **React Hook Form** | 7.53    | Formularios performantes        |
| **Zod**             | 3.23    | Validación de esquemas          |
| **Zustand**         | 5       | State management liviano        |
| **Recharts**        | 2.13    | Gráficos y visualizaciones      |
| **ExcelJS / XLSX**  | —       | Exportación Excel en cliente    |
| **date-fns**        | 4.1     | Manejo de fechas                |
| **DOMPurify**       | 3.1     | Sanitización HTML (anti-XSS)    |
| **jsQR**            | 1.4     | Lectura de códigos QR           |
| **Lucide React**    | 0.451   | Iconos                          |

### Backend

| Tecnología                   | Versión | Uso                               |
| ---------------------------- | ------- | --------------------------------- |
| **NestJS**                   | 10.4    | Framework modular                 |
| **Fastify**                  | 4.28    | HTTP server de alto rendimiento   |
| **TypeScript**               | 5.6     | Tipado estático                   |
| **Prisma ORM**               | 5.22    | Acceso a BD type-safe             |
| **MariaDB / MySQL**          | 11      | Base de datos relacional          |
| **JWT**                      | —       | Auth stateless (access + refresh) |
| **Argon2**                   | 0.41    | Hash de contraseñas (OWASP)       |
| **otplib**                   | 12      | TOTP 2FA (RFC 6238)               |
| **ExcelJS**                  | 4.4     | Generación Excel servidor         |
| **PDFKit**                   | 0.18    | Generación PDF servidor           |
| **Twilio**                   | 6       | SMS                               |
| **nestjs-pino**              | 4.1     | Logging estructurado JSON         |
| **@nestjs/throttler**        | 6.2     | Rate limiting                     |
| **@nestjs/terminus**         | 10.2    | Health checks                     |
| **@fastify/helmet**          | —       | Headers de seguridad HTTP         |
| **@fastify/csrf-protection** | —       | Protección CSRF                   |
| **@nestjs/swagger**          | 7.4     | API docs OpenAPI 3                |

### Infraestructura & Tooling

| Herramienta            | Uso                                     |
| ---------------------- | --------------------------------------- |
| **pnpm workspaces**    | Monorepo                                |
| **Turborepo**          | Build orchestration                     |
| **Docker multi-stage** | Imágenes de producción mínimas (Alpine) |
| **Nginx**              | Servidor web + reverse proxy SPA        |
| **Husky + Commitlint** | Git hooks + commits convencionales      |
| **Prettier + ESLint**  | Formato y calidad de código             |
| **Vitest**             | Tests unitarios y E2E                   |

---

## 🏗 Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet / HTTPS                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │    Nginx    │  Reverse proxy + TLS + SPA
                    └──────┬──────┘
               ┌───────────┴───────────┐
               │                       │
        ┌──────▼──────┐        ┌───────▼──────┐
        │  React SPA  │        │  NestJS API  │
        │  (Vite PWA) │        │  (Fastify)   │
        └─────────────┘        └───────┬──────┘
                                       │ Prisma ORM
                               ┌───────▼──────┐
                               │   MariaDB    │
                               │  (multi-     │
                               │   tenant)    │
                               └──────────────┘

       TanStack Router            JWT + Argon2 + TOTP
       TanStack Query              Rate Limit + Helmet
       Zustand                     Audit Hash Chain
```

### Estructura multi-tenant

```
School A ──┐
School B ──┼──► UserSchoolRole (usuario × escuela × rol)
School C ──┘         │
                     ▼
         Aislamiento de datos por schoolId
         en todos los queries y guards
```

Cada escuela es completamente aislada. Un **SUPER_ADMIN** gestiona todas las escuelas; un **DIRECTOR** solo ve la suya.

---

## 🔐 Seguridad

Implementaciones basadas en **OWASP Top 10**, **NIST 800-63B**, **CIS Controls** y **CISA Best Practices**.

### Autenticación & Autorización

| Control                    | Implementación                                                               |
| -------------------------- | ---------------------------------------------------------------------------- |
| **Password hashing**       | Argon2id (memory 64 MB, t=3, p=4) — OWASP recomendado sobre bcrypt           |
| **JWT stateless**          | Access token 15 min + Refresh token 7d con rotación automática               |
| **Refresh token rotation** | Familia de tokens — detección de reuso (theft detection)                     |
| **2FA / MFA**              | TOTP RFC 6238 con QR code + 8 códigos de respaldo hasheados SHA-256          |
| **Trusted devices**        | Token hash SHA-256 en BD, TTL 7 días, skip TOTP en dispositivos de confianza |
| **RBAC**                   | 5 roles jerárquicos + permisos granulares por escuela                        |
| **Account lockout**        | Bloqueo tras intentos fallidos, desbloqueo manual por admin                  |

### Seguridad en Transporte & Red

| Control                     | Implementación                                                         |
| --------------------------- | ---------------------------------------------------------------------- |
| **HTTPS forzado**           | `upgradeInsecureRequests` en CSP                                       |
| **HTTP Security Headers**   | `@fastify/helmet` — X-Frame-Options, X-Content-Type-Options, HSTS      |
| **Content Security Policy** | `defaultSrc 'self'`, `objectSrc 'none'`, `frameAncestors 'none'`       |
| **CORS estricto**           | Whitelist de orígenes, métodos y headers explícitos                    |
| **CSRF Protection**         | `@fastify/csrf-protection` + cookies `SameSite=Strict`                 |
| **Rate Limiting**           | Global 120 req/min · Login 5 intentos/5 min · Registro 3/hora          |
| **Trazabilidad**            | `X-Request-ID` en todos los requests (UUID v4 si no viene del cliente) |

### Integridad & Auditoría

| Control                    | Implementación                                                           |
| -------------------------- | ------------------------------------------------------------------------ |
| **Audit log inmutable**    | Evento por acción, JSON metadata, IP, user-agent                         |
| **Hash chain**             | SHA-256 encadenado — detecta modificación retroactiva de registros       |
| **Validación RUT chileno** | Algoritmo módulo 11 oficial, normalización automática                    |
| **Input validation**       | `class-validator` + `whitelist:true` (rechaza propiedades no declaradas) |
| **XSS prevention**         | DOMPurify frontend + sanitización backend                                |
| **SQL injection**          | Prisma ORM con queries parametrizadas — nunca SQL crudo                  |
| **Secrets**                | Variables de entorno, nunca hardcodeadas · Swagger solo en dev           |

### Principios aplicados

- **Least Privilege** — Cada rol accede solo a lo que necesita
- **Defense in Depth** — Validación en DTO → guard → servicio → BD
- **Fail Secure** — Errores retornan 401/403, nunca exponen stack traces en producción
- **Secure by Default** — Swagger UI desactivado en `NODE_ENV=production`

---

## 🚀 Inicio Rápido

### Prerequisitos

```bash
node --version   # >= 22.0.0
pnpm --version   # >= 9.0.0
# MariaDB 10.5+ o MySQL 8.0+ corriendo
```

### Instalación

```bash
# 1. Clonar
git clone https://github.com/TeguiHD/GestorInstitucional.git
cd GestorInstitucional

# 2. Instalar dependencias
pnpm install

# 3. Configurar variables de entorno
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Editar ambos archivos con tus valores

# 4. Crear BD y aplicar migraciones
pnpm --filter @asistencia/api prisma:migrate

# 5. Seed con datos de ejemplo (opcional)
pnpm --filter @asistencia/api db:seed

# 6. Iniciar en modo desarrollo
pnpm dev
```

La aplicación estará disponible en:

- **Frontend** → http://localhost:5173
- **API** → http://localhost:4000/api/v1
- **Swagger** → http://localhost:4000/docs

### Con Docker

```bash
# Levantar todos los servicios
docker compose up -d

# Ver logs
docker compose logs -f api
```

---

## ⚙️ Variables de Entorno

### API (`apps/api/.env`)

```env
# Entorno
NODE_ENV=development

# Base de Datos
DATABASE_URL="mysql://usuario:contraseña@localhost:3306/gestor_institucional"

# Servidor
API_PORT=4000
API_HOST=0.0.0.0
API_PUBLIC_URL=http://localhost:4000

# JWT — mínimo 32 caracteres, secretos diferentes entre sí
JWT_ACCESS_SECRET=cambia_esto_minimo_32_chars_aaaa
JWT_REFRESH_SECRET=cambia_esto_minimo_32_chars_bbbb
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# Argon2 (password hashing)
ARGON2_MEMORY_COST=65536
ARGON2_TIME_COST=3
ARGON2_PARALLELISM=4

# 2FA TOTP
TOTP_ISSUER=GestorInstitucional
TOTP_WINDOW=1

# CORS
CORS_ORIGINS=http://localhost:5173

# Rate Limiting
RATE_LIMIT_GLOBAL_TTL=60
RATE_LIMIT_GLOBAL_MAX=120

# Cookies
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false
COOKIE_SAMESITE=lax

# Logging
LOG_LEVEL=debug
```

### Web (`apps/web/.env`)

```env
VITE_API_BASE_URL=http://localhost:4000/api/v1
```

---

## 📜 Scripts disponibles

```bash
# Desarrollo
pnpm dev                    # Inicia API + Web en paralelo

# Build
pnpm build                  # Compila todo para producción

# Calidad de código
pnpm lint                   # ESLint en todos los paquetes
pnpm typecheck              # TypeScript check
pnpm format                 # Prettier

# Tests
pnpm test                                             # Vitest unitarios
pnpm --filter @asistencia/api test:e2e                # Tests E2E API

# Base de Datos
pnpm --filter @asistencia/api prisma:migrate          # Crear y aplicar migración
pnpm --filter @asistencia/api prisma:deploy           # Aplicar migraciones (producción)
pnpm --filter @asistencia/api prisma:studio           # UI visual de la BD
pnpm --filter @asistencia/api db:seed                 # Poblar datos de ejemplo
```

---

## 📂 Estructura del Proyecto

```
gestor-institucional/
├── apps/
│   ├── api/                          # Backend NestJS + Fastify
│   │   ├── src/
│   │   │   ├── auth/                 # JWT, 2FA TOTP, refresh tokens
│   │   │   ├── attendance/           # Registro, estadísticas, reportes
│   │   │   ├── audit/                # Log inmutable con hash chain
│   │   │   ├── alerts/               # Reglas y triggers de alertas
│   │   │   ├── calendar/             # Días festivos, suspensiones
│   │   │   ├── common/               # Guards, decoradores, interceptores
│   │   │   ├── config/               # Validación de config con Zod
│   │   │   ├── courses/              # Cursos, profesores jefes
│   │   │   ├── enrollment/           # Historial de matrícula + CSV import
│   │   │   ├── grades/               # Calificaciones por período
│   │   │   ├── health/               # Health checks
│   │   │   ├── insights/             # Analytics y dashboards
│   │   │   ├── justifications/       # Workflow de justificaciones
│   │   │   ├── mail/                 # Cola de correos (Brevo)
│   │   │   ├── notifications/        # Notificaciones push
│   │   │   ├── reports/              # Excel, PDF, SIGE MINEDUC
│   │   │   ├── schedule/             # Horarios
│   │   │   ├── students/             # Alumnos, apoderados
│   │   │   ├── subjects/             # Asignaturas por curso
│   │   │   └── users/                # RBAC, escuelas, multi-tenant
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # 26 modelos + 8 enums
│   │   │   ├── migrations/           # Migraciones versionadas
│   │   │   └── seed.ts               # Datos de ejemplo
│   │   └── Dockerfile
│   │
│   └── web/                          # Frontend React SPA
│       ├── src/
│       │   ├── routes/               # 28+ rutas file-based TanStack Router
│       │   ├── features/             # Módulos de negocio
│       │   │   ├── attendance/       # Registro y estadísticas
│       │   │   ├── courses/          # Cursos + tabs (alumnos, asignaturas)
│       │   │   ├── students/         # Perfil con historial por período
│       │   │   ├── reports/          # Descarga de Excel/PDF
│       │   │   ├── settings/         # Configuración + multi-tenant admin
│       │   │   └── ...
│       │   ├── components/           # UI components (Radix + Tailwind)
│       │   ├── lib/                  # API client, utilidades, RUT validator
│       │   └── store/                # Zustand stores
│       └── Dockerfile
│
├── packages/
│   ├── shared/                       # DTOs y tipos compartidos
│   └── config/                       # ESLint + tsconfig compartidos
│
├── turbo.json                        # Pipeline de build Turborepo
├── pnpm-workspace.yaml
└── commitlint.config.cjs
```

---

## 🗃 Modelos de Datos

El sistema cuenta con **26 modelos Prisma** organizados en dominios:

```
┌─────────────────────────────────────────────────────────────┐
│  MULTI-TENANT CORE                                          │
│  School ─── UserSchoolRole ─── User ─── TotpSecret         │
│                                    └─── RefreshToken        │
│                                    └─── TrustedDevice       │
├─────────────────────────────────────────────────────────────┤
│  ACADÉMICO                                                  │
│  Course ─── CourseTeacher ─── User (profesor)              │
│         ─── Student ────────── Guardianship ─── User       │
│         ─── Subject (asignatura × curso × docente)         │
│         ─── ScheduleSlot (día × bloque × hora)             │
├─────────────────────────────────────────────────────────────┤
│  ASISTENCIA                                                 │
│  AttendanceRecord ─── Student, Course                      │
│  AttendanceJustification ─── AttendanceRecord              │
│  EnrollmentEvent ─── Student, Course                       │
├─────────────────────────────────────────────────────────────┤
│  CALIFICACIONES                                             │
│  Grade ─── Student, Subject (por período GradePeriod)      │
├─────────────────────────────────────────────────────────────┤
│  COMUNICACIONES                                             │
│  MailOutbox · Notification · GuardianContact               │
├─────────────────────────────────────────────────────────────┤
│  SISTEMA                                                    │
│  AlertRule · AlertFired · AuditEvent · SchoolCalendarDay    │
└─────────────────────────────────────────────────────────────┘
```

### Enums principales

| Enum                  | Valores                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `SystemRole`          | `SUPER_ADMIN` · `DIRECTOR` · `UTP` · `PROFESOR` · `APODERADO`                               |
| `AttendanceStatus`    | `PRESENT` · `ABSENT` · `LATE` · `JUSTIFIED` · `WITHDRAWN`                                   |
| `JustificationStatus` | `PENDING` · `APPROVED` · `REJECTED`                                                         |
| `EnrollmentStatus`    | `ACTIVE` · `WITHDRAWN` · `TRANSFERRED_OUT` · `TRANSFERRED_IN` · `RE_ENROLLED` · `GRADUATED` |
| `GradePeriod`         | `P1` · `P2` · `E1` · `P3` · `P4` · `E2` · `NF`                                              |

---

## 📡 API Reference

Documentación interactiva disponible en `/docs` (Swagger UI, solo en dev).

### Endpoints principales

```
POST   /api/v1/auth/login                        Autenticación (+ TOTP si activo)
POST   /api/v1/auth/refresh                      Rotación de refresh token
POST   /api/v1/auth/2fa/setup                    Configurar autenticador TOTP
POST   /api/v1/auth/2fa/verify                   Activar 2FA
DELETE /api/v1/auth/2fa                          Desactivar 2FA

GET    /api/v1/attendance/course/:id             Asistencia de un curso
POST   /api/v1/attendance                        Registrar asistencia bulk (idempotente)
GET    /api/v1/attendance/student/:id            Historial de un alumno
GET    /api/v1/attendance/school/:id/stats       Estadísticas globales

GET    /api/v1/reports/course/:id/excel          Excel mensual
GET    /api/v1/reports/course/:id/pdf            PDF mensual
GET    /api/v1/reports/course/:id/monthly-grid-pdf  Grilla SIGE MINEDUC
GET    /api/v1/reports/course/:id/sige           Formato oficial SIGE
GET    /api/v1/reports/course/:id/semester       Excel semestral

POST   /api/v1/enrollment/import                 Importar alumnos desde CSV

PATCH  /api/v1/subjects/:id/teacher              Asignar docente a asignatura

GET    /api/v1/schools                           Listar escuelas (SUPER_ADMIN)
POST   /api/v1/schools                           Crear escuela con director inicial

GET    /api/v1/health                            Health check (DB status)
```

---

## 👤 Roles y Permisos

| Acción                    | SUPER_ADMIN | DIRECTOR | UTP |     PROFESOR     | APODERADO |
| ------------------------- | :---------: | :------: | :-: | :--------------: | :-------: |
| Gestionar escuelas        |     ✅      |    —     |  —  |        —         |     —     |
| Gestionar usuarios        |     ✅      |    ✅    |  —  |        —         |     —     |
| Ver todos los cursos      |     ✅      |    ✅    | ✅  | Solo los propios |     —     |
| Registrar asistencia      |     ✅      |    ✅    | ✅  |        ✅        |     —     |
| Exportar reportes         |     ✅      |    ✅    | ✅  |        ✅        |     —     |
| Aprobar justificaciones   |     ✅      |    ✅    | ✅  |        —         |     —     |
| Ver asistencia de pupilos |     ✅      |    —     |  —  |        —         |    ✅     |
| Cargar justificaciones    |      —      |    —     |  —  |        —         |    ✅     |
| Auditoría                 |     ✅      |    ✅    |  —  |        —         |     —     |
| Desbloquear cuentas       |     ✅      |    ✅    |  —  |        —         |     —     |

---

## 🌐 Escalabilidad Multi-Tenant

El sistema está diseñado para ser vendido a múltiples establecimientos:

```
SUPER_ADMIN (Proveedor del SaaS)
    ├── Colegio San Sebastián de Paine
    │       ├── Director, UTP, Profesores, Apoderados
    │       └── Cursos, Alumnos, Asignaturas...
    │
    ├── Colegio Santa María
    │       └── Completamente aislado del anterior
    │
    └── Instituto XYZ
            └── Mismo aislamiento total de datos
```

- Cada escuela tiene su propia configuración de alertas, calendario y permisos
- Los datos están aislados a nivel de query (`WHERE schoolId = ?`)
- Un SUPER_ADMIN puede onboardear un colegio nuevo desde `/configuracion`
- El director recibe credenciales automáticamente y gestiona su establecimiento de forma independiente

---

## 🗺 Roadmap

- [ ] App móvil React Native (registro offline + sync)
- [ ] Integración directa con SIGE MINEDUC via API oficial
- [ ] Reconocimiento facial con cámara para control de asistencia
- [ ] Dashboard Power BI embebido
- [ ] Módulo de libro de clases digital
- [ ] Firma digital de documentos (justificaciones)
- [ ] Integración WhatsApp Business API
- [ ] Sistema de pagos para licencias SaaS

---

## 🤝 Contribuir

```bash
# Crear rama para tu feature
git checkout -b feature/mi-funcionalidad

# Commits convencionales (commitlint)
git commit -m "feat: agregar funcionalidad X"
git commit -m "fix: corregir bug en Y"
git commit -m "docs: actualizar README"

# Pull Request
git push origin feature/mi-funcionalidad
```

Los commits siguen [Conventional Commits](https://www.conventionalcommits.org/).

---

## 📄 Licencia

MIT © 2026 [TeguiHD](https://github.com/TeguiHD)

---

<div align="center">

Hecho con ❤️ para los colegios de Chile

**[⬆ volver arriba](#-gestor-institucional)**

</div>
