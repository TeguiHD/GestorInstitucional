#!/usr/bin/env bash
# =============================================================================
# diag-attendance-dates.sh  ·  SOLO LECTURA / READ-ONLY
# -----------------------------------------------------------------------------
# Diagnostica el corrimiento de fechas de asistencia y los bloqueos de guardado
# SIN modificar ningún dato. No ejecuta UPDATE/DELETE/INSERT. Seguro en prod.
#
# Uso (en el VPS, donde corren los contenedores):
#   bash infra/diagnostics/diag-attendance-dates.sh
#
# Requiere: contenedores asistencia_api y asistencia_db en marcha.
# =============================================================================
set -uo pipefail

API=asistencia_api
DB=asistencia_db

line() { printf '\n=== %s ===\n' "$1"; }

# mariadb client dentro del contenedor db (usa el root password del entorno)
dbq() {
  docker exec -e MYSQL_PWD="" "$DB" sh -c \
    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" -t -e "$0"' "$1"
}

echo "######################################################################"
echo "#  DIAGNÓSTICO FECHAS ASISTENCIA — SOLO LECTURA — $(date -u +%FT%TZ)"
echo "######################################################################"

# -----------------------------------------------------------------------------
line "1. Timezone del proceso API (Node)"
docker exec "$API" sh -c 'echo "TZ=$TZ"; date; node -e "console.log(new Date().toString(), \"offsetMin=\"+new Date().getTimezoneOffset())"'

# -----------------------------------------------------------------------------
line "2. Timezone de MariaDB"
dbq "SELECT @@global.time_zone AS global_tz, @@session.time_zone AS session_tz, NOW() AS db_now, UTC_TIMESTAMP() AS db_utc;"

# -----------------------------------------------------------------------------
line "3. DESAMBIGUADOR — cómo materializa Prisma un @db.Date (clave del +1)"
echo "   Esperado limpio: iso ...T00:00:00.000Z  utcH=0  (el guard +1 NO debe disparar)"
docker exec "$API" sh -c 'cd /app 2>/dev/null; node -e "
const {PrismaClient}=require(\"@prisma/client\"); const p=new PrismaClient();
(async()=>{
  const r = await p.attendanceRecord.findFirst({ orderBy:{ updatedAt:\"desc\" }, select:{ date:true, updatedAt:true }});
  if(!r){console.log(\"(sin registros)\");process.exit(0);}
  const d=r.date;
  console.log(\"iso=\"+d.toISOString(), \"utcH=\"+d.getUTCHours(), \"localStr=\"+d.toString());
  process.exit(0);
})().catch(e=>{console.error(\"ERR\",e.message);process.exit(1);});
"' || echo "   (no se pudo correr Prisma; revisar WORKDIR del contenedor)"

# -----------------------------------------------------------------------------
line "3b. Distribución de horas UTC al materializar (mide cuántas filas tocaría el guard +1)"
docker exec "$API" sh -c 'cd /app 2>/dev/null; node -e "
const {PrismaClient}=require(\"@prisma/client\"); const p=new PrismaClient();
(async()=>{
  const rows = await p.\$queryRawUnsafe(\"SELECT date FROM attendance_records\");
  const b={mid_0:0, early_1to5:0, mid_day_6to17:0, evening_18to23:0};
  for(const r of rows){const h=new Date(r.date).getUTCHours();
    if(h===0)b.mid_0++; else if(h<=5)b.early_1to5++; else if(h<=17)b.mid_day_6to17++; else b.evening_18to23++;}
  console.log(JSON.stringify(b), \"total=\"+rows.length);
  process.exit(0);
})().catch(e=>{console.error(\"ERR\",e.message);process.exit(1);});
"' || echo "   (no se pudo correr Prisma)"

# -----------------------------------------------------------------------------
line "4. SMOKING GUN — asistencia en SÁBADO/DOMINGO (no debería existir; school = Lun-Vie)"
echo "   Filas en fin de semana = evidencia directa de fechas corridas."
dbq "SELECT YEAR(date) y, MONTH(date) m, DAYNAME(date) dow, COUNT(*) n
     FROM attendance_records
     WHERE DAYOFWEEK(date) IN (1,7)
     GROUP BY y,m,dow ORDER BY y,m;"

# -----------------------------------------------------------------------------
line "5. Asistencia 14–17 de junio 2026 por curso (¿existe el 15? ¿está corrido?)"
dbq "SELECT c.name curso, ar.date, DAYNAME(ar.date) dow, COUNT(*) n
     FROM attendance_records ar JOIN courses c ON c.id=ar.courseId
     WHERE ar.date BETWEEN '2026-06-13' AND '2026-06-18'
     GROUP BY c.name, ar.date ORDER BY ar.date, curso;"

# -----------------------------------------------------------------------------
line "6. ESTEBAN — todas sus filas de junio 2026 (¿días 8/11? ¿duplicados/corridos?)"
dbq "SELECT s.firstName, s.lastName, ar.date, DAYNAME(ar.date) dow, ar.status, ar.updatedAt
     FROM attendance_records ar JOIN students s ON s.id=ar.studentId
     WHERE s.firstName LIKE 'Esteban%'
       AND (s.lastName LIKE 'Ar_nguiz%' OR s.lastName LIKE 'Aranguiz%' OR s.lastName LIKE 'Aránguiz%')
       AND ar.date BETWEEN '2026-06-01' AND '2026-06-30'
     ORDER BY ar.date;"

# -----------------------------------------------------------------------------
line "7. Días no lectivos de junio (¿algún feriado/suspensión cae el 15? bloquearía la columna)"
dbq "SELECT sc.schoolId, sc.date, DAYNAME(sc.date) dow, sc.type, sc.description, sc.createdAt
     FROM school_calendar_days sc
     WHERE sc.date BETWEEN '2026-06-01' AND '2026-06-30'
     ORDER BY sc.date;"

# -----------------------------------------------------------------------------
line "8. ¿Las escrituras RECIENTES caen en el día correcto? (últimos 20 registros)"
echo "   Si una fila actualizada hoy cae en fin de semana o día inesperado => el write actual corre."
dbq "SELECT ar.date, DAYNAME(ar.date) dow, ar.status, ar.recordedAt, ar.updatedAt
     FROM attendance_records ar
     ORDER BY ar.updatedAt DESC LIMIT 20;"

# -----------------------------------------------------------------------------
line "9. Versión/commit desplegado del API (para confirmar si corre el commit 3321173)"
docker exec "$API" sh -c 'cat /app/REVISION 2>/dev/null || cat /app/.git/HEAD 2>/dev/null || node -e "try{console.log(require(\"/app/package.json\").version)}catch(e){console.log(\"(sin version)\")}"' 2>/dev/null || echo "   (no determinable)"

echo
echo "######################################################################"
echo "#  FIN — ningún dato fue modificado."
echo "######################################################################"
