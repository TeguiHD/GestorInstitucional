# Reportes SIGE (MINEDUC)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generar un Excel en formato SIGE (Sistema de Información General de Educación, MINEDUC Chile) para exportar la asistencia mensual de un curso: columnas RUT | Apellido Paterno | Apellido Materno | Nombres | día1…díaN | Total Presentes | Total Ausentes.

**Architecture:** Nuevo endpoint `GET /reports/course/:courseId/sige?year=&month=` en el `ReportsController` / `ReportsService` existentes (módulo `reports` ya tiene ExcelJS). Frontend: botón "Exportar SIGE" en `CourseDetailPage` junto a los otros botones de exportación existentes.

**Tech Stack:** NestJS + ExcelJS (ya instalado) + Prisma (backend), React + TanStack Query (frontend), TypeScript.

---

## Critical Files

**Backend (modify):**

- `apps/api/src/reports/reports.controller.ts` — add `GET /reports/course/:courseId/sige` endpoint
- `apps/api/src/reports/reports.service.ts` — add `generateSigeExcel()` method

**Frontend (modify):**

- `apps/web/src/features/courses/CourseDetailPage.tsx` — add "Exportar SIGE" button

---

## Task 1: Backend — `generateSigeExcel()` method

**Files:**

- Modify: `apps/api/src/reports/reports.service.ts`

- [ ] **Step 1: Understand the existing data access pattern**

Read the existing `generateCourseExcel` method (line ~24) to understand how the service:

1. Looks up the course and verifies teacher access via `UserSchoolRole`
2. Queries `AttendanceRecord` for the month
3. Queries `Student` list for the course

The SIGE method follows the same pattern.

- [ ] **Step 2: Add `generateSigeExcel()` method**

Add after `generateSemesterPdf()` (end of class):

```typescript
async generateSigeExcel(courseId: string, year: number, month: number, requestedById: string): Promise<Buffer> {
  const y = Number(year);
  const m = Number(month);

  // Verify course access (same pattern as other methods)
  const course = await this.prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: { school: true },
  });

  const hasAccess = await this.prisma.userSchoolRole.findFirst({
    where: { userId: requestedById, schoolId: course.schoolId },
  });
  if (!hasAccess) throw new Error('Sin acceso a este curso');

  // Calendar: all school days in this month (Mon–Fri only)
  const daysInMonth = new Date(y, m, 0).getDate();
  const schoolDays: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) schoolDays.push(d);
  }

  // Students (active, sorted by enrollmentNumber)
  const students = await this.prisma.student.findMany({
    where: { courseId, active: true },
    orderBy: { enrollmentNumber: 'asc' },
  });

  // Attendance records for the month
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0, 23, 59, 59);
  const records = await this.prisma.attendanceRecord.findMany({
    where: { courseId, date: { gte: from, lte: to } },
    select: { studentId: true, date: true, status: true },
  });

  // Index: studentId → day → status
  const idx = new Map<string, Map<number, string>>();
  for (const r of records) {
    if (!idx.has(r.studentId)) idx.set(r.studentId, new Map());
    idx.get(r.studentId)!.set(new Date(r.date).getDate(), r.status);
  }

  // Build Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`SIGE ${y}-${String(m).padStart(2, '0')}`);

  // Header row
  const MONTH_NAMES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const headers = [
    'RUT',
    'Apellido Paterno',
    'Apellido Materno',
    'Nombres',
    ...schoolDays.map(String),
    'Total Presentes',
    'Total Ausentes',
  ];
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, size: 10 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 30;

  // SIGE status codes: P=presente/atraso, F=falta, J=justificado, blank=no class
  const toSige = (status: string | undefined): string => {
    if (!status) return '';
    if (status === 'PRESENT' || status === 'LATE') return 'P';
    if (status === 'ABSENT') return 'F';
    if (status === 'JUSTIFIED') return 'J';
    return '';
  };

  // Student rows
  for (const student of students) {
    const dayMap = idx.get(student.id) ?? new Map<number, string>();
    const dayValues = schoolDays.map((d) => toSige(dayMap.get(d)));
    const presentes = dayValues.filter((v) => v === 'P').length;
    const ausentes = dayValues.filter((v) => v === 'F').length;

    // Split lastName into paterno + materno (CSSP stores "APELLIDO1 APELLIDO2" space-separated)
    const parts = student.lastName.trim().split(/\s+/);
    const apPaterno = parts[0] ?? '';
    const apMaterno = parts.slice(1).join(' ') || (student.secondLastName ?? '');

    const row = ws.addRow([
      student.rut,
      apPaterno,
      apMaterno,
      student.firstName,
      ...dayValues,
      presentes,
      ausentes,
    ]);
    row.font = { size: 9 };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    // Left-align name columns
    row.getCell(1).alignment = { horizontal: 'left' };
    row.getCell(2).alignment = { horizontal: 'left' };
    row.getCell(3).alignment = { horizontal: 'left' };
    row.getCell(4).alignment = { horizontal: 'left' };

    // Color cells: P=green, F=red, J=yellow
    dayValues.forEach((v, i) => {
      const cell = row.getCell(5 + i);
      if (v === 'P') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
      else if (v === 'F') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE5CD' } };
      else if (v === 'J') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    });
  }

  // Column widths
  ws.getColumn(1).width = 14; // RUT
  ws.getColumn(2).width = 18; // Ap Paterno
  ws.getColumn(3).width = 18; // Ap Materno
  ws.getColumn(4).width = 18; // Nombres
  schoolDays.forEach((_, i) => { ws.getColumn(5 + i).width = 4; });
  ws.getColumn(5 + schoolDays.length).width = 8;     // Total Presentes
  ws.getColumn(6 + schoolDays.length).width = 8;     // Total Ausentes

  // Freeze header + name columns
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1, activeCell: 'E2' }];

  // Metadata sheet
  const meta = wb.addWorksheet('Portada');
  meta.addRow(['Establecimiento:', course.school.name]);
  meta.addRow(['Curso:', course.name]);           // e.g. "1° Básico A"
  meta.addRow(['Código:', course.code]);          // e.g. "1A"
  meta.addRow(['Período:', `${MONTH_NAMES[m]} ${y}`]);
  meta.addRow(['Generado:', new Date().toLocaleDateString('es-CL')]);
  meta.addRow(['Formato:', 'SIGE MINEDUC — P=Presente, F=Falta, J=Justificado']);
  meta.getColumn(1).width = 20;
  meta.getColumn(2).width = 40;

  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}
```

---

## Task 2: Backend — controller endpoint

**Files:**

- Modify: `apps/api/src/reports/reports.controller.ts`

- [ ] **Step 1: Add SIGE endpoint**

After `getSemesterPdf()`, add:

```typescript
@Get('course/:courseId/sige')
@ApiOperation({ summary: 'Exportar asistencia mensual formato SIGE MINEDUC' })
async getSigeExcel(
  @Param('courseId') courseId: string,
  @Query('year') year: number,
  @Query('month') month: number,
  @CurrentUser() user: JwtPayload,
  @Res() res: FastifyReply,
) {
  const buffer = await this.reports.generateSigeExcel(courseId, year, month, user.sub);
  void res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  void res.header(
    'Content-Disposition',
    `attachment; filename="sige-${String(year)}-${String(month).padStart(2, '0')}.xlsx"`,
  );
  void res.header('Cache-Control', 'no-store');
  void res.send(buffer);
}
```

- [ ] **Step 2: Typecheck API**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 3: Frontend — SIGE download button in `CourseDetailPage`

**Files:**

- Modify: `apps/web/src/features/courses/CourseDetailPage.tsx`

- [ ] **Step 1: Locate existing export buttons**

Search for `excel` or `exportar` in `CourseDetailPage.tsx` — there are already download buttons for Excel/PDF. Find the function that calls the reports endpoint (likely something like `handleDownloadExcel`).

- [ ] **Step 2: Add SIGE download handler**

Near the existing download handlers, add. Do NOT use `api.getBlob` (it doesn't exist) — use `fetch` directly, mirroring the same auth pattern as `apps/web/src/lib/api.ts` (reads from `localStorage.getItem('access_token')`):

````typescript
const handleDownloadSige = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  try {
    const token = localStorage.getItem('access_token');
    const base = (import.meta as { env: Record<string, string> }).env['VITE_API_BASE_URL'] ?? '/api/v1';
    const res = await fetch(
      `${base}/reports/course/${courseId}/sige?year=${year}&month=${month}`,
      { headers: { Authorization: `Bearer ${token ?? ''}` } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sige-${year}-${String(month).padStart(2, '0')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error('Error al generar SIGE');
  }
};

- [ ] **Step 3: Add SIGE button to the UI**

Find where the existing Excel/PDF buttons are rendered in `CourseDetailPage`. Add the SIGE button alongside them:

```tsx
<button
  onClick={() => void handleDownloadSige()}
  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
  title="Exportar formato SIGE MINEDUC"
>
  <FileSpreadsheet className="size-3.5" />
  SIGE
</button>
````

Add `FileSpreadsheet` to lucide-react imports if not already present.

- [ ] **Step 4: Typecheck web**

```bash
pnpm --filter @asistencia/web exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 4: Build + Deploy

- [ ] **Step 1: Build both**

```bash
pnpm --filter @asistencia/api build && pnpm --filter @asistencia/web build
```

Expected: 0 errors on both.

- [ ] **Step 2: Deploy API and web dist**

No Prisma schema change in this feature — only deploy `dist/`.

```bash
tar -czf /tmp/api-dist.tar.gz -C apps/api/dist .
tar -czf /tmp/web-dist.tar.gz -C apps/web/dist .
scp /tmp/api-dist.tar.gz /tmp/web-dist.tar.gz root@45.55.214.153:/tmp/

ssh root@45.55.214.153 "
  docker cp /tmp/api-dist.tar.gz asistencia_api:/tmp/ && \
  docker exec -u 0 asistencia_api sh -c 'cd /app/apps/api && rm -rf dist && mkdir dist && tar -xzf /tmp/api-dist.tar.gz -C dist' && \
  docker cp /tmp/web-dist.tar.gz asistencia_web:/tmp/ && \
  docker exec -u 0 asistencia_web sh -c 'rm -rf /usr/share/nginx/html/* && tar -xzf /tmp/web-dist.tar.gz -C /usr/share/nginx/html' && \
  docker restart asistencia_api && \
  echo 'deployed'
"
```

- [ ] **Step 3: Verify health**

```bash
curl -s https://asistencia.nicoholas.dev/api/v1/health | python3 -m json.tool
```

Expected: `{"status":"ok","info":{"database":{"status":"up"}}}`.

---

## Verification

1. Ir a un curso con alumnos y asistencia registrada.
2. Click "SIGE" → descarga `sige-2026-04.xlsx`.
3. Abrir en Excel/LibreOffice → verificar:
   - Hoja "Portada": nombre escuela, curso, período.
   - Hoja "SIGE 2026-04": columnas RUT, Apellido Paterno, Apellido Materno, Nombres, luego días hábiles del mes (números), Total Presentes, Total Ausentes.
   - Celdas con P=verde, F=naranja, J=amarillo.
   - Primeras 4 columnas congeladas (scroll horizontal muestra días).
4. Alumno con 20 días presentes → "Total Presentes" = 20.
5. Alumno con 3 faltas → "Total Ausentes" = 3.
