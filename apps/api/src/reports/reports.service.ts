import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const DOW_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async generateCourseExcel(
    courseId: string,
    year: number,
    month: number,
    requestedById: string,
  ): Promise<Buffer> {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(from, to),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: from, lte: to } },
      select: { studentId: true, date: true, status: true },
    });

    const recordMap = new Map<string, Map<string, string>>();
    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };
    for (const r of records) {
      const key = r.date.toISOString().split('T')[0]!;
      if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
      recordMap.get(r.studentId)!.set(key, SYMBOL[r.status] ?? '-');
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';
    wb.created = new Date();

    this.buildMonthSheet(wb, {
      course,
      year,
      month,
      to,
      records: recordMap,
    });

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, month, format: 'xlsx' },
    });

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Formal monthly PDF report. Institutional layout — header with school + course, table per alumno with % asistencia, signature block. */
  async generateCoursePdf(
    courseId: string,
    year: number,
    month: number,
    requestedById: string,
  ): Promise<Buffer> {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(from, to),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: from, lte: to } },
      select: { studentId: true, status: true },
    });

    const perStudent = new Map<string, { p: number; a: number; l: number; j: number }>();
    for (const s of course.students) perStudent.set(s.id, { p: 0, a: 0, l: 0, j: 0 });
    for (const r of records) {
      const e = perStudent.get(r.studentId);
      if (!e) continue;
      if (r.status === 'PRESENT') e.p++;
      else if (r.status === 'ABSENT') e.a++;
      else if (r.status === 'LATE') e.l++;
      else if (r.status === 'JUSTIFIED') e.j++;
    }

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    const logoPath = process.env.SCHOOL_LOGO_PATH ?? join(process.cwd(), 'assets', 'logo-cssp.png');
    if (existsSync(logoPath)) {
      try {
        doc.image(logoPath, 48, 40, { fit: [60, 60] });
      } catch {
        /* ignore bad image */
      }
    }

    doc
      .fontSize(16)
      .fillColor('#1F4E79')
      .font('Helvetica-Bold')
      .text(course.school.name.toUpperCase(), 120, 48, { align: 'left' });
    doc
      .fontSize(11)
      .fillColor('#333')
      .font('Helvetica')
      .text('Informe Mensual de Asistencia', 120, 70);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 120, 86);

    doc.moveTo(48, 115).lineTo(547, 115).strokeColor('#1F4E79').lineWidth(1.2).stroke();

    const monthName = MONTH_NAMES_ES[month - 1] ?? '';
    doc
      .fontSize(13)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .text(`${course.name} — ${monthName} ${year}`, 48, 128);
    const head = course.teachers[0]?.user;
    doc
      .fontSize(10)
      .fillColor('#555')
      .font('Helvetica')
      .text(`Profesor jefe: ${head ? `${head.firstName} ${head.lastName}` : '—'}`, 48, 148)
      .text(`Alumnos activos: ${course.students.length}`, 48, 162);

    let y = 190;
    const rowH = 18;
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('N°', 54, y + 5, { width: 28 });
    doc.text('Alumno', 88, y + 5, { width: 230 });
    doc.text('RUT', 322, y + 5, { width: 70 });
    doc.text('P', 396, y + 5, { width: 22, align: 'center' });
    doc.text('A', 420, y + 5, { width: 22, align: 'center' });
    doc.text('AT', 444, y + 5, { width: 22, align: 'center' });
    doc.text('J', 468, y + 5, { width: 22, align: 'center' });
    doc.text('% Asist.', 494, y + 5, { width: 50, align: 'center' });
    y += rowH;

    doc.font('Helvetica').fontSize(9).fillColor('#000');
    let totalRate = 0;
    let totalStudents = 0;
    for (const [i, s] of course.students.entries()) {
      if (y > 760) {
        doc.addPage();
        y = 60;
      }
      const c = perStudent.get(s.id)!;
      const tot = c.p + c.a + c.l + c.j;
      const rate = tot > 0 ? (c.p + c.l) / tot : 0;
      if (tot > 0) {
        totalRate += rate;
        totalStudents++;
      }
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(String(s.enrollmentNumber), 54, y + 5, { width: 28 });
      doc.text(
        `${s.lastName}${s.secondLastName ? ' ' + s.secondLastName : ''}, ${s.firstName}`,
        88,
        y + 5,
        { width: 230, ellipsis: true },
      );
      doc.text(s.rut, 322, y + 5, { width: 70 });
      doc.text(String(c.p), 396, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.a), 420, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.l), 444, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.j), 468, y + 5, { width: 22, align: 'center' });
      const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(tot > 0 ? `${(rate * 100).toFixed(1)}%` : '—', 494, y + 5, {
        width: 50,
        align: 'center',
      });
      doc.fillColor('#000').font('Helvetica');
      y += rowH;
    }

    const avg = totalStudents > 0 ? totalRate / totalStudents : 0;
    y += 10;
    doc.rect(48, y, 499, 24).fill('#DCE6F1');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(10);
    doc.text(`Asistencia promedio del curso: ${(avg * 100).toFixed(1)}%`, 54, y + 7, {
      width: 499 - 12,
    });
    y += 48;

    if (y > 720) {
      doc.addPage();
      y = 80;
    }
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text('_______________________________________', 80, y + 40);
    doc.text('_______________________________________', 340, y + 40);
    doc.text('Profesor Jefe', 130, y + 55);
    doc.text('Dirección', 400, y + 55);

    doc
      .fontSize(7)
      .fillColor('#999')
      .text(
        `Documento generado automáticamente — ${course.school.name} · ${new Date().toISOString()}`,
        48,
        800,
        { width: 499, align: 'center' },
      );

    doc.end();
    await done;

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, month, format: 'pdf' },
    });

    return Buffer.concat(chunks);
  }

  /** MINEDUC-style monthly PDF: landscape A4 with day×student grid mirroring the official Excel template. */
  async generateMonthlyGridPdf(
    courseId: string,
    year: number,
    month: number,
    requestedById: string,
  ): Promise<Buffer> {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(from, to),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const daysInMonth = to.getDate();

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: from, lte: to } },
      select: { studentId: true, date: true, status: true },
    });

    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };
    const recordMap = new Map<string, Map<number, string>>();
    for (const r of records) {
      const day = r.date.getUTCDate();
      if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
      recordMap.get(r.studentId)!.set(day, SYMBOL[r.status] ?? '-');
    }

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    const PAGE_W = 842;
    const NAV_X = 28;
    const NUM_W = 22;
    const NAME_W = 175;
    const DAY_W = 14.5;
    const SUM_W = 22;
    const PCT_W = 38;
    const TABLE_W = NUM_W + NAME_W + DAY_W * daysInMonth + SUM_W * 4 + PCT_W;
    const ROW_H = 15;

    const monthName = MONTH_NAMES_ES[month - 1] ?? '';
    const drawHeader = () => {
      const logoPath =
        process.env.SCHOOL_LOGO_PATH ?? join(process.cwd(), 'assets', 'logo-cssp.png');
      if (existsSync(logoPath)) {
        try {
          doc.image(logoPath, NAV_X, 22, { fit: [44, 44] });
        } catch {
          /* ignore */
        }
      }
      doc
        .fontSize(13)
        .fillColor('#1F4E79')
        .font('Helvetica-Bold')
        .text(course.school.name.toUpperCase(), NAV_X + 52, 26);
      doc
        .fontSize(9)
        .fillColor('#333')
        .font('Helvetica')
        .text('Lista Mensual de Asistencia · Formato MINEDUC', NAV_X + 52, 44);
      const head = course.teachers[0]?.user;
      doc
        .fontSize(8)
        .fillColor('#666')
        .text(
          `Profesor jefe: ${head ? `${head.firstName} ${head.lastName}` : '—'}    ·    Alumnos: ${course.students.length}    ·    Emitido: ${new Date().toLocaleDateString('es-CL')}`,
          NAV_X + 52,
          58,
        );
      doc
        .fontSize(11)
        .fillColor('#000')
        .font('Helvetica-Bold')
        .text(`${course.name}  —  ${monthName} ${year}`, PAGE_W - 28 - 220, 30, {
          width: 220,
          align: 'right',
        });
      doc
        .moveTo(NAV_X, 76)
        .lineTo(PAGE_W - NAV_X, 76)
        .strokeColor('#1F4E79')
        .lineWidth(1)
        .stroke();
    };

    const drawTableHeader = (yPos: number) => {
      let x = NAV_X;
      doc.rect(x, yPos, TABLE_W, ROW_H + 12).fill('#1F4E79');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
      doc.text('Nº', x + 2, yPos + 10, { width: NUM_W - 4, align: 'center' });
      x += NUM_W;
      doc.text('Alumno', x + 4, yPos + 10, { width: NAME_W - 6 });
      x += NAME_W;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dow = date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        if (isWeekend) doc.rect(x, yPos, DAY_W, ROW_H + 12).fill('#7A8FA0');
        doc.fillColor('#fff').fontSize(7);
        doc.text(String(d), x, yPos + 3, { width: DAY_W, align: 'center' });
        doc.text(DOW_LABELS[dow] ?? '', x, yPos + 14, { width: DAY_W, align: 'center' });
        x += DAY_W;
      }
      doc.fontSize(8);
      doc.text('P', x, yPos + 10, { width: SUM_W, align: 'center' });
      x += SUM_W;
      doc.text('A', x, yPos + 10, { width: SUM_W, align: 'center' });
      x += SUM_W;
      doc.text('AT', x, yPos + 10, { width: SUM_W, align: 'center' });
      x += SUM_W;
      doc.text('J', x, yPos + 10, { width: SUM_W, align: 'center' });
      x += SUM_W;
      doc.text('% Asist.', x, yPos + 10, { width: PCT_W, align: 'center' });
      return yPos + ROW_H + 12;
    };

    drawHeader();
    let y = drawTableHeader(86);

    doc.font('Helvetica').fontSize(7);
    let totalRate = 0;
    let totalStudents = 0;

    for (const [i, s] of course.students.entries()) {
      if (y + ROW_H > 560) {
        doc.addPage();
        drawHeader();
        y = drawTableHeader(86);
        doc.font('Helvetica').fontSize(7);
      }

      let x = NAV_X;
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(x, y, TABLE_W, ROW_H).fill(band);
      doc.fillColor('#000').font('Helvetica').fontSize(7);
      doc.text(String(s.enrollmentNumber), x + 2, y + 4, { width: NUM_W - 4, align: 'center' });
      x += NUM_W;
      const fullName = `${s.lastName}${s.secondLastName ? ' ' + s.secondLastName : ''}, ${s.firstName}`;
      doc.text(fullName, x + 3, y + 4, { width: NAME_W - 5, ellipsis: true, lineBreak: false });
      x += NAME_W;

      let p = 0,
        a = 0,
        l = 0,
        j = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dow = date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        if (isWeekend) {
          doc.rect(x, y, DAY_W, ROW_H).fill('#E8EDF1');
        }
        const sym = this.attendanceSymbolFor(s, date, recordMap.get(s.id)?.get(d));
        if (sym) {
          let bg = '#FFFFFF';
          let fg = '#000';
          if (sym === '1') {
            bg = '#16A34A';
            fg = '#fff';
            p++;
          } else if (sym === '0') {
            bg = '#DC2626';
            fg = '#fff';
            a++;
          } else if (sym === 'AT') {
            bg = '#EA580C';
            fg = '#fff';
            l++;
          } else if (sym === 'J') {
            bg = '#FACC15';
            fg = '#000';
            j++;
          }
          doc.rect(x, y, DAY_W, ROW_H).fill(bg);
          doc.fillColor(fg).font('Helvetica-Bold').fontSize(6.5);
          doc.text(sym, x, y + 4.5, { width: DAY_W, align: 'center' });
          doc.font('Helvetica').fontSize(7);
        }
        x += DAY_W;
      }

      const tot = p + a + l + j;
      const rate = tot > 0 ? (p + l) / tot : 0;
      if (tot > 0) {
        totalRate += rate;
        totalStudents++;
      }

      doc.fillColor('#000').font('Helvetica');
      doc.text(String(p), x, y + 4, { width: SUM_W, align: 'center' });
      x += SUM_W;
      doc.text(String(a), x, y + 4, { width: SUM_W, align: 'center' });
      x += SUM_W;
      doc.text(String(l), x, y + 4, { width: SUM_W, align: 'center' });
      x += SUM_W;
      doc.text(String(j), x, y + 4, { width: SUM_W, align: 'center' });
      x += SUM_W;
      const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(tot > 0 ? `${(rate * 100).toFixed(1)}%` : '—', x, y + 4, {
        width: PCT_W,
        align: 'center',
      });
      doc.fillColor('#000').font('Helvetica');

      y += ROW_H;
    }

    const avg = totalStudents > 0 ? totalRate / totalStudents : 0;
    y += 6;
    if (y + 60 > 580) {
      doc.addPage();
      y = 80;
    }
    doc.rect(NAV_X, y, TABLE_W, 22).fill('#DCE6F1');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(10);
    doc.text(`Asistencia promedio del curso: ${(avg * 100).toFixed(1)}%`, NAV_X + 8, y + 6);
    y += 36;

    doc.fillColor('#000').font('Helvetica').fontSize(8);
    doc.text('Leyenda: 1 = Presente  ·  0 = Ausente  ·  AT = Atraso  ·  J = Justificado', NAV_X, y);
    y += 28;
    doc.text('_______________________________', NAV_X + 60, y);
    doc.text('_______________________________', PAGE_W - NAV_X - 220, y);
    doc.fontSize(8).text('Profesor Jefe', NAV_X + 110, y + 14);
    doc.text('Dirección', PAGE_W - NAV_X - 150, y + 14);

    doc
      .fontSize(6)
      .fillColor('#999')
      .text(
        `Documento generado automáticamente — ${course.school.name} · ${new Date().toISOString()}`,
        NAV_X,
        575,
        { width: TABLE_W, align: 'center' },
      );

    doc.end();
    await done;

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, month, format: 'monthly_grid_pdf' },
    });

    return Buffer.concat(chunks);
  }

  async generateWeeklyExcel(
    courseId: string,
    weekStart: string,
    requestedById: string,
  ): Promise<Buffer> {
    const start = new Date(weekStart + 'T12:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(start, end),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: start, lte: end } },
      select: { studentId: true, date: true, status: true },
    });

    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };
    const recordMap = new Map<string, Map<string, string>>();
    for (const r of records) {
      const key = r.date.toISOString().split('T')[0]!;
      if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
      recordMap.get(r.studentId)!.set(key, SYMBOL[r.status] ?? '-');
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';

    const days: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const dd = new Date(start);
      dd.setDate(dd.getDate() + d);
      days.push(dd);
    }

    const ws = wb.addWorksheet('SEMANA', { views: [{ showGridLines: false }] });
    const GREEN = 'FF00B050';
    const RED = 'FFC00000';
    const YELLOW = 'FFFFFF00';
    const ORANGE = 'FFED7D31';
    const BLUE = 'FF1F4E79';
    const GRAY = 'FFD9D9D9';
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    const centerMid = { horizontal: 'center' as const, vertical: 'middle' as const };

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 35;
    for (let c = 3; c <= 9; c++) ws.getColumn(c).width = 10;
    ws.getColumn(10).width = 8;
    ws.getColumn(11).width = 8;
    ws.getColumn(12).width = 9;
    ws.getColumn(13).width = 8;

    ws.mergeCells('A1:M1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `${course.school.name} — LISTA SEMANAL`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    titleCell.alignment = centerMid;
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:M2');
    ws.getCell('A2').value =
      `${course.name}  |  Semana ${start.toLocaleDateString('es-CL')} – ${end.toLocaleDateString('es-CL')}`;
    ws.getCell('A2').alignment = centerMid;
    ws.getCell('A2').font = { bold: true, size: 11 };
    ws.getRow(2).height = 18;

    const headerRow = ws.getRow(3);
    headerRow.height = 20;
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    [
      'Nº',
      'Alumno',
      ...days.map((d) => `${dayNames[d.getDay()]}\n${d.getDate()}/${d.getMonth() + 1}`),
      'Asist.',
      'Ausent.',
      '% Asist.',
      'Justif.',
    ].forEach((h, i) => {
      const cell = ws.getCell(3, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.alignment = { ...centerMid, wrapText: true };
      cell.border = borderAll;
    });

    course.students.forEach((student, idx) => {
      const r = idx + 4;
      ws.getCell(r, 1).value = idx + 1;
      ws.getCell(r, 1).border = borderAll;
      ws.getCell(r, 1).alignment = centerMid;
      ws.getCell(r, 2).value =
        `${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`;
      ws.getCell(r, 2).border = borderAll;

      let present = 0,
        absent = 0,
        justified = 0;
      days.forEach((d, di) => {
        const key = d.toISOString().split('T')[0]!;
        const sym = this.attendanceSymbolFor(student, d, recordMap.get(student.id)?.get(key));
        const cell = ws.getCell(r, 3 + di);
        cell.border = borderAll;
        cell.alignment = centerMid;
        cell.font = { bold: true, size: 9 };
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        if (isWeekend) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
        }
        if (!sym) return;
        cell.value = sym;
        if (sym === '1') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
          cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
          present++;
        } else if (sym === '0') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
          cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
          absent++;
        } else if (sym === 'J') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
          justified++;
        } else if (sym === 'AT') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
          cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
          present++;
        }
      });

      const total = present + absent + justified;
      const pct = total > 0 ? present / total : 0;
      ws.getCell(r, 10).value = present;
      ws.getCell(r, 10).border = borderAll;
      ws.getCell(r, 10).alignment = centerMid;
      ws.getCell(r, 10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
      ws.getCell(r, 11).value = absent;
      ws.getCell(r, 11).border = borderAll;
      ws.getCell(r, 11).alignment = centerMid;
      ws.getCell(r, 11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
      const pctCell = ws.getCell(r, 12);
      pctCell.value = pct;
      pctCell.numFmt = '0.0%';
      pctCell.border = borderAll;
      pctCell.alignment = centerMid;
      pctCell.font = { bold: true };
      pctCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: pct >= 0.9 ? 'FFE2EFDA' : pct >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };
      ws.getCell(r, 13).value = justified;
      ws.getCell(r, 13).border = borderAll;
      ws.getCell(r, 13).alignment = centerMid;
      ws.getCell(r, 13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    });

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { weekStart, format: 'weekly_xlsx' },
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async generateSemesterExcel(
    courseId: string,
    year: number,
    semester: number,
    requestedById: string,
  ): Promise<Buffer> {
    const months = semester === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
    const semFrom = new Date(year, months[0]! - 1, 1);
    const semTo = new Date(year, months[months.length - 1]!, 0, 23, 59, 59);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(semFrom, semTo),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';

    const summary = new Map<string, { p: number; a: number; j: number; byMonth: number[] }>();
    for (const s of course.students) summary.set(s.id, { p: 0, a: 0, j: 0, byMonth: [] });

    // Single query for all semester months — group in memory by month
    const allRecords = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: semFrom, lte: semTo } },
      select: { studentId: true, date: true, status: true },
    });
    const byMonth = new Map<number, Array<{ studentId: string; date: Date; status: string }>>();
    for (const r of allRecords) {
      const m = r.date.getMonth() + 1;
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(r);
    }

    for (const month of months) {
      const records = byMonth.get(month) ?? [];
      const to = new Date(year, month, 0);
      const recordMap = new Map<string, Map<string, string>>();
      for (const r of records) {
        const key = r.date.toISOString().split('T')[0]!;
        if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
        recordMap.get(r.studentId)!.set(key, SYMBOL[r.status] ?? '-');
      }
      this.buildMonthSheet(wb, { course, year, month, to, records: recordMap });

      for (const r of records) {
        const e = summary.get(r.studentId);
        if (!e) continue;
        if (r.status === 'PRESENT' || r.status === 'LATE') e.p++;
        else if (r.status === 'ABSENT') e.a++;
        else if (r.status === 'JUSTIFIED') e.j++;
      }
    }

    // Summary sheet
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    const centerMid = { horizontal: 'center' as const, vertical: 'middle' as const };
    const BLUE = 'FF1F4E79';
    const ws = wb.addWorksheet('RESUMEN SEMESTRAL', { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 35;
    ws.getColumn(3).width = 9;
    ws.getColumn(4).width = 9;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 9;

    ws.mergeCells('A1:F1');
    ws.getCell('A1').value =
      `${course.school.name} — RESUMEN SEMESTRE ${semester} ${year} — ${course.name}`;
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell('A1').alignment = centerMid;
    ws.getRow(1).height = 22;

    ['Nº', 'Alumno', 'Asist.', 'Ausent.', '% Asist.', 'Justif.'].forEach((h, i) => {
      const c = ws.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.alignment = centerMid;
      c.border = borderAll;
    });

    course.students.forEach((student, idx) => {
      const r = idx + 3;
      const e = summary.get(student.id) ?? { p: 0, a: 0, j: 0 };
      const total = e.p + e.a + e.j;
      const pct = total > 0 ? e.p / total : 0;
      ws.getCell(r, 1).value = idx + 1;
      ws.getCell(r, 1).border = borderAll;
      ws.getCell(r, 1).alignment = centerMid;
      ws.getCell(r, 2).value =
        `${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`;
      ws.getCell(r, 2).border = borderAll;
      ws.getCell(r, 3).value = e.p;
      ws.getCell(r, 3).border = borderAll;
      ws.getCell(r, 3).alignment = centerMid;
      ws.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
      ws.getCell(r, 4).value = e.a;
      ws.getCell(r, 4).border = borderAll;
      ws.getCell(r, 4).alignment = centerMid;
      ws.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
      const pctCell = ws.getCell(r, 5);
      pctCell.value = pct;
      pctCell.numFmt = '0.0%';
      pctCell.border = borderAll;
      pctCell.alignment = centerMid;
      pctCell.font = { bold: true };
      pctCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: pct >= 0.9 ? 'FFE2EFDA' : pct >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };
      ws.getCell(r, 6).value = e.j;
      ws.getCell(r, 6).border = borderAll;
      ws.getCell(r, 6).alignment = centerMid;
      ws.getCell(r, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    });

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, semester, format: 'semester_xlsx' },
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async generateAnnualExcel(
    courseId: string,
    year: number,
    requestedById: string,
  ): Promise<Buffer> {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const yearFrom = new Date(year, 0, 1);
    const yearTo = new Date(year, 11, 31, 23, 59, 59);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(yearFrom, yearTo),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';

    const summary = new Map<string, { p: number; a: number; j: number }>();
    for (const s of course.students) summary.set(s.id, { p: 0, a: 0, j: 0 });

    // Single query for entire year — group in memory by month
    const allRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        courseId,
        date: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59) },
      },
      select: { studentId: true, date: true, status: true },
    });
    const byMonth = new Map<number, Array<{ studentId: string; date: Date; status: string }>>();
    for (const r of allRecords) {
      const m = r.date.getMonth() + 1;
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(r);
    }

    for (const month of months) {
      const records = byMonth.get(month) ?? [];
      const to = new Date(year, month, 0);
      const recordMap = new Map<string, Map<string, string>>();
      for (const r of records) {
        const key = r.date.toISOString().split('T')[0]!;
        if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
        recordMap.get(r.studentId)!.set(key, SYMBOL[r.status] ?? '-');
      }
      this.buildMonthSheet(wb, { course, year, month, to, records: recordMap });

      for (const r of records) {
        const e = summary.get(r.studentId);
        if (!e) continue;
        if (r.status === 'PRESENT' || r.status === 'LATE') e.p++;
        else if (r.status === 'ABSENT') e.a++;
        else if (r.status === 'JUSTIFIED') e.j++;
      }
    }

    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    const centerMid = { horizontal: 'center' as const, vertical: 'middle' as const };
    const BLUE = 'FF1F4E79';
    const ws = wb.addWorksheet('RESUMEN ANUAL', { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 35;
    ws.getColumn(3).width = 9;
    ws.getColumn(4).width = 9;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 9;

    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = `${course.school.name} — RESUMEN ANUAL ${year} — ${course.name}`;
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell('A1').alignment = centerMid;
    ws.getRow(1).height = 22;

    ['Nº', 'Alumno', 'Asist.', 'Ausent.', '% Asist.', 'Justif.'].forEach((h, i) => {
      const c = ws.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.alignment = centerMid;
      c.border = borderAll;
    });

    course.students.forEach((student, idx) => {
      const r = idx + 3;
      const e = summary.get(student.id) ?? { p: 0, a: 0, j: 0 };
      const total = e.p + e.a + e.j;
      const pct = total > 0 ? e.p / total : 0;
      ws.getCell(r, 1).value = idx + 1;
      ws.getCell(r, 1).border = borderAll;
      ws.getCell(r, 1).alignment = centerMid;
      ws.getCell(r, 2).value =
        `${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`;
      ws.getCell(r, 2).border = borderAll;
      ws.getCell(r, 3).value = e.p;
      ws.getCell(r, 3).border = borderAll;
      ws.getCell(r, 3).alignment = centerMid;
      ws.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
      ws.getCell(r, 4).value = e.a;
      ws.getCell(r, 4).border = borderAll;
      ws.getCell(r, 4).alignment = centerMid;
      ws.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
      const pctCell = ws.getCell(r, 5);
      pctCell.value = pct;
      pctCell.numFmt = '0.0%';
      pctCell.border = borderAll;
      pctCell.alignment = centerMid;
      pctCell.font = { bold: true };
      pctCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: pct >= 0.9 ? 'FFE2EFDA' : pct >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };
      ws.getCell(r, 6).value = e.j;
      ws.getCell(r, 6).border = borderAll;
      ws.getCell(r, 6).alignment = centerMid;
      ws.getCell(r, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    });

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, format: 'annual_xlsx' },
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async generateSemesterPdf(
    courseId: string,
    year: number,
    semester: number,
    requestedById: string,
  ): Promise<Buffer> {
    const months = semester === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
    const semLabel = semester === 1 ? '1er Semestre' : '2do Semestre';
    const semFrom = new Date(year, months[0]! - 1, 1);
    const semTo = new Date(year, months[months.length - 1]!, 0, 23, 59, 59);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(semFrom, semTo),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const perStudent = new Map<string, { p: number; a: number; l: number; j: number }>();
    for (const s of course.students) perStudent.set(s.id, { p: 0, a: 0, l: 0, j: 0 });

    // Single query for all semester months
    const allSemRecords = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: semFrom, lte: semTo } },
      select: { studentId: true, status: true },
    });
    for (const r of allSemRecords) {
      const e = perStudent.get(r.studentId);
      if (!e) continue;
      if (r.status === 'PRESENT') e.p++;
      else if (r.status === 'ABSENT') e.a++;
      else if (r.status === 'LATE') e.l++;
      else if (r.status === 'JUSTIFIED') e.j++;
    }

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    const logoPath = process.env.SCHOOL_LOGO_PATH ?? join(process.cwd(), 'assets', 'logo-cssp.png');
    if (existsSync(logoPath)) {
      try {
        doc.image(logoPath, 48, 40, { fit: [60, 60] });
      } catch {
        /* ignore */
      }
    }

    doc
      .fontSize(16)
      .fillColor('#1F4E79')
      .font('Helvetica-Bold')
      .text(course.school.name.toUpperCase(), 120, 48, { align: 'left' });
    doc
      .fontSize(11)
      .fillColor('#333')
      .font('Helvetica')
      .text(`Informe Semestral de Asistencia — ${semLabel} ${year}`, 120, 70);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 120, 86);
    doc.moveTo(48, 115).lineTo(547, 115).strokeColor('#1F4E79').lineWidth(1.2).stroke();

    doc
      .fontSize(13)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .text(`${course.name} — ${semLabel} ${year}`, 48, 128);
    const head = course.teachers[0]?.user;
    doc
      .fontSize(10)
      .fillColor('#555')
      .font('Helvetica')
      .text(`Profesor jefe: ${head ? `${head.firstName} ${head.lastName}` : '—'}`, 48, 148)
      .text(`Meses: ${months.map((m) => MONTH_NAMES_ES[m - 1]).join(', ')}`, 48, 162);

    let y = 190;
    const rowH = 18;
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('N°', 54, y + 5, { width: 28 });
    doc.text('Alumno', 88, y + 5, { width: 230 });
    doc.text('RUT', 322, y + 5, { width: 70 });
    doc.text('P', 396, y + 5, { width: 22, align: 'center' });
    doc.text('A', 420, y + 5, { width: 22, align: 'center' });
    doc.text('AT', 444, y + 5, { width: 22, align: 'center' });
    doc.text('J', 468, y + 5, { width: 22, align: 'center' });
    doc.text('% Asist.', 494, y + 5, { width: 50, align: 'center' });
    y += rowH;

    doc.font('Helvetica').fontSize(9).fillColor('#000');
    let totalRate = 0;
    let totalStudents = 0;
    for (const [i, s] of course.students.entries()) {
      if (y > 760) {
        doc.addPage();
        y = 60;
      }
      const c = perStudent.get(s.id)!;
      const tot = c.p + c.a + c.l + c.j;
      const rate = tot > 0 ? (c.p + c.l) / tot : 0;
      if (tot > 0) {
        totalRate += rate;
        totalStudents++;
      }
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(String(s.enrollmentNumber), 54, y + 5, { width: 28 });
      doc.text(
        `${s.lastName}${s.secondLastName ? ' ' + s.secondLastName : ''}, ${s.firstName}`,
        88,
        y + 5,
        { width: 230, ellipsis: true },
      );
      doc.text(s.rut, 322, y + 5, { width: 70 });
      doc.text(String(c.p), 396, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.a), 420, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.l), 444, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.j), 468, y + 5, { width: 22, align: 'center' });
      const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(tot > 0 ? `${(rate * 100).toFixed(1)}%` : '—', 494, y + 5, {
        width: 50,
        align: 'center',
      });
      doc.fillColor('#000').font('Helvetica');
      y += rowH;
    }

    const avg = totalStudents > 0 ? totalRate / totalStudents : 0;
    y += 10;
    doc.rect(48, y, 499, 24).fill('#DCE6F1');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(10);
    doc.text(`Asistencia promedio semestral del curso: ${(avg * 100).toFixed(1)}%`, 54, y + 7, {
      width: 499 - 12,
    });
    y += 48;
    if (y > 720) {
      doc.addPage();
      y = 80;
    }
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text('_______________________________________', 80, y + 40);
    doc.text('_______________________________________', 340, y + 40);
    doc.text('Profesor Jefe', 130, y + 55);
    doc.text('Dirección', 400, y + 55);
    doc
      .fontSize(7)
      .fillColor('#999')
      .text(
        `Documento generado automáticamente — ${course.school.name} · ${new Date().toISOString()}`,
        48,
        800,
        { width: 499, align: 'center' },
      );

    doc.end();
    await done;
    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, semester, format: 'semester_pdf' },
    });
    return Buffer.concat(chunks);
  }

  async generateAnnualPdf(courseId: string, year: number, requestedById: string): Promise<Buffer> {
    const yearFrom = new Date(year, 0, 1);
    const yearTo = new Date(year, 11, 31, 23, 59, 59);

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.activeDuringPeriodWhere(yearFrom, yearTo),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const perStudent = new Map<string, { p: number; a: number; l: number; j: number }>();
    for (const s of course.students) perStudent.set(s.id, { p: 0, a: 0, l: 0, j: 0 });

    // Single query for entire year
    const allAnnualRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        courseId,
        date: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59) },
      },
      select: { studentId: true, status: true },
    });
    for (const r of allAnnualRecords) {
      const e = perStudent.get(r.studentId);
      if (!e) continue;
      if (r.status === 'PRESENT') e.p++;
      else if (r.status === 'ABSENT') e.a++;
      else if (r.status === 'LATE') e.l++;
      else if (r.status === 'JUSTIFIED') e.j++;
    }

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    const logoPath = process.env.SCHOOL_LOGO_PATH ?? join(process.cwd(), 'assets', 'logo-cssp.png');
    if (existsSync(logoPath)) {
      try {
        doc.image(logoPath, 48, 40, { fit: [60, 60] });
      } catch {
        /* ignore */
      }
    }

    doc
      .fontSize(16)
      .fillColor('#1F4E79')
      .font('Helvetica-Bold')
      .text(course.school.name.toUpperCase(), 120, 48, { align: 'left' });
    doc
      .fontSize(11)
      .fillColor('#333')
      .font('Helvetica')
      .text(`Informe Anual de Asistencia — ${year}`, 120, 70);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 120, 86);
    doc.moveTo(48, 115).lineTo(547, 115).strokeColor('#1F4E79').lineWidth(1.2).stroke();

    doc
      .fontSize(13)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .text(`${course.name} — ${year}`, 48, 128);
    const head = course.teachers[0]?.user;
    doc
      .fontSize(10)
      .fillColor('#555')
      .font('Helvetica')
      .text(`Profesor jefe: ${head ? `${head.firstName} ${head.lastName}` : '—'}`, 48, 148)
      .text(`Periodo: ${MONTH_NAMES_ES[0]} – ${MONTH_NAMES_ES[11]}`, 48, 162);

    let y = 190;
    const rowH = 18;
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('N°', 54, y + 5, { width: 28 });
    doc.text('Alumno', 88, y + 5, { width: 230 });
    doc.text('RUT', 322, y + 5, { width: 70 });
    doc.text('P', 396, y + 5, { width: 22, align: 'center' });
    doc.text('A', 420, y + 5, { width: 22, align: 'center' });
    doc.text('AT', 444, y + 5, { width: 22, align: 'center' });
    doc.text('J', 468, y + 5, { width: 22, align: 'center' });
    doc.text('% Asist.', 494, y + 5, { width: 50, align: 'center' });
    y += rowH;

    doc.font('Helvetica').fontSize(9).fillColor('#000');
    let totalRate = 0;
    let totalStudents = 0;
    for (const [i, s] of course.students.entries()) {
      if (y > 760) {
        doc.addPage();
        y = 60;
      }
      const c = perStudent.get(s.id)!;
      const tot = c.p + c.a + c.l + c.j;
      const rate = tot > 0 ? (c.p + c.l) / tot : 0;
      if (tot > 0) {
        totalRate += rate;
        totalStudents++;
      }
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(String(s.enrollmentNumber), 54, y + 5, { width: 28 });
      doc.text(
        `${s.lastName}${s.secondLastName ? ' ' + s.secondLastName : ''}, ${s.firstName}`,
        88,
        y + 5,
        { width: 230, ellipsis: true },
      );
      doc.text(s.rut, 322, y + 5, { width: 70 });
      doc.text(String(c.p), 396, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.a), 420, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.l), 444, y + 5, { width: 22, align: 'center' });
      doc.text(String(c.j), 468, y + 5, { width: 22, align: 'center' });
      const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(tot > 0 ? `${(rate * 100).toFixed(1)}%` : '—', 494, y + 5, {
        width: 50,
        align: 'center',
      });
      doc.fillColor('#000').font('Helvetica');
      y += rowH;
    }

    const avg = totalStudents > 0 ? totalRate / totalStudents : 0;
    y += 10;
    doc.rect(48, y, 499, 24).fill('#DCE6F1');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(10);
    doc.text(`Asistencia promedio anual del curso: ${(avg * 100).toFixed(1)}%`, 54, y + 7, {
      width: 499 - 12,
    });
    y += 48;
    if (y > 720) {
      doc.addPage();
      y = 80;
    }
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text('_______________________________________', 80, y + 40);
    doc.text('_______________________________________', 340, y + 40);
    doc.text('Profesor Jefe', 130, y + 55);
    doc.text('Dirección', 400, y + 55);
    doc
      .fontSize(7)
      .fillColor('#999')
      .text(
        `Documento generado automáticamente — ${course.school.name} · ${new Date().toISOString()}`,
        48,
        800,
        { width: 499, align: 'center' },
      );

    doc.end();
    await done;
    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, format: 'annual_pdf' },
    });
    return Buffer.concat(chunks);
  }

  private buildMonthSheet(
    wb: ExcelJS.Workbook,
    ctx: {
      course: {
        name: string;
        school: { name: string };
        teachers: Array<{ user: { firstName: string; lastName: string } }>;
        students: Array<{
          id: string;
          firstName: string;
          lastName: string;
          secondLastName: string | null;
          enrolledAt: Date;
          withdrawnAt: Date | null;
        }>;
      };
      year: number;
      month: number;
      to: Date;
      records: Map<string, Map<string, string>>;
    },
  ) {
    const { course, year, month, to, records } = ctx;
    const monthName = MONTH_NAMES_ES[month - 1] ?? '';
    const ws = wb.addWorksheet(monthName.toUpperCase(), {
      pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
      views: [{ showGridLines: false }],
    });

    const GREEN = 'FF00B050';
    const RED = 'FFC00000';
    const YELLOW = 'FFFFFF00';
    const ORANGE = 'FFED7D31';
    const BLUE = 'FF1F4E79';
    const LIGHT_BLUE = 'FFDCE6F1';
    const GRAY = 'FFD9D9D9';

    // ---- Column widths (match template) ----
    ws.getColumn(1).width = 1.25; // A gutter
    ws.getColumn(2).width = 5; // B Nº
    ws.getColumn(3).width = 33.5; // C Name
    ws.getColumn(4).width = 0.75; // D gutter
    for (let c = 5; c <= 35; c++) ws.getColumn(c).width = 4.125; // E..AI day cols
    for (let c = 36; c <= 39; c++) ws.getColumn(c).width = 8; // AJ..AM summary

    const centerMid = {
      horizontal: 'center' as const,
      vertical: 'middle' as const,
      wrapText: true,
    };
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };

    // ---- Row 1: title ----
    ws.mergeCells('B1:AM1');
    const title = ws.getCell('B1');
    title.value = 'LISTA DE ASISTENCIA';
    title.alignment = centerMid;
    title.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getRow(1).height = 28;

    // ---- Row 3-4: school name merged ----
    ws.mergeCells('E3:U4');
    const school = ws.getCell('E3');
    school.value = course.school.name.toUpperCase();
    school.alignment = centerMid;
    school.font = { bold: true, size: 14 };

    ws.mergeCells('Z2:AD2');
    const logoPath = process.env.SCHOOL_LOGO_PATH ?? join(process.cwd(), 'assets', 'logo-cssp.png');
    if (existsSync(logoPath)) {
      const ext =
        logoPath.toLowerCase().endsWith('.jpg') || logoPath.toLowerCase().endsWith('.jpeg')
          ? 'jpeg'
          : 'png';
      const imgId = wb.addImage({
        buffer: readFileSync(logoPath).buffer as ArrayBuffer,
        extension: ext,
      });
      ws.addImage(imgId, {
        tl: { col: 25, row: 1 },
        ext: { width: 120, height: 60 },
        editAs: 'oneCell',
      });
      ws.getRow(2).height = 48;
    } else {
      const logoSlot = ws.getCell('Z2');
      logoSlot.value = 'LOGO';
      logoSlot.alignment = centerMid;
      logoSlot.font = { italic: true, color: { argb: 'FFA6A6A6' } };
    }

    // ---- Row 5: teacher ----
    const teacher = course.teachers[0]?.user;
    const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : '';
    ws.getCell('E5').value = `Profesor/a Jefe: ${teacherName}`;
    ws.getCell('E5').font = { italic: true, size: 11 };

    ws.mergeCells('AE3:AF3');
    ws.getCell('AE3').value = 'CURSO';
    ws.getCell('AE3').alignment = centerMid;
    ws.getCell('AE3').font = { bold: true };
    ws.mergeCells('AE5:AF5');
    ws.getCell('AE5').value = 'AÑO';
    ws.getCell('AE5').alignment = centerMid;
    ws.getCell('AE5').font = { bold: true };
    ws.mergeCells('AE7:AF7');
    ws.getCell('AE7').value = 'MES';
    ws.getCell('AE7').alignment = centerMid;
    ws.getCell('AE7').font = { bold: true };

    // ---- Row 7: CURSO label + value ----
    ws.getCell('B7').value = 'CURSO:';
    ws.getCell('B7').font = { bold: true };
    ws.mergeCells('S7:U7');
    ws.getCell('S7').value = course.name;
    ws.getCell('S7').alignment = centerMid;
    ws.getCell('S7').font = { bold: true, size: 12 };
    ws.getCell('S7').border = borderAll;

    ws.getCell('AG7').value = year;
    ws.getCell('AG7').alignment = centerMid;
    ws.getCell('AG7').font = { bold: true };
    ws.getCell('AG7').border = borderAll;

    // ---- Row 9: MES ----
    ws.mergeCells('S9:U9');
    ws.getCell('S9').value = monthName;
    ws.getCell('S9').alignment = centerMid;
    ws.getCell('S9').font = { bold: true, size: 12 };
    ws.getCell('S9').border = borderAll;
    ws.mergeCells('AE9:AF9');
    ws.getCell('AE9').value = monthName;
    ws.getCell('AE9').alignment = centerMid;
    ws.getCell('AE9').font = { bold: true };

    // ---- Day header (rows 11-13): day number + DOW ----
    const daysInMonth = to.getDate();
    // Day columns: E(5) to E+daysInMonth-1, max AI(35) → 31 days
    for (let d = 1; d <= daysInMonth; d++) {
      const c = 4 + d; // E=5 for day 1
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;

      const dayCell = ws.getCell(11, c);
      dayCell.value = d;
      dayCell.alignment = centerMid;
      dayCell.font = { bold: true, size: 9 };
      dayCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isWeekend ? GRAY : LIGHT_BLUE },
      };
      dayCell.border = borderAll;

      const dowCell = ws.getCell(12, c);
      dowCell.value = DOW_LABELS[dow];
      dowCell.alignment = centerMid;
      dowCell.font = { bold: true, size: 9 };
      dowCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isWeekend ? GRAY : LIGHT_BLUE },
      };
      dowCell.border = borderAll;
    }

    // Row 13: headers Nº / Name / day num repeat (actually template keeps r13 as "Nº | Nombres...")
    ws.getCell('B13').value = 'Nº';
    ws.getCell('B13').alignment = centerMid;
    ws.getCell('B13').font = { bold: true };
    ws.getCell('B13').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell('B13').font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell('B13').border = borderAll;

    ws.getCell('C13').value = 'Nombres y Apellidos';
    ws.getCell('C13').alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getCell('C13').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell('C13').font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell('C13').border = borderAll;

    // Summary column headers (rows 11-13 merged AJ..AM)
    const summary = [
      { col: 'AJ', label: 'ASISTENCIA', color: GREEN },
      { col: 'AK', label: 'AUSENCIA', color: RED },
      { col: 'AL', label: '% ASIST.', color: ORANGE },
      { col: 'AM', label: 'JUSTIF.', color: YELLOW },
    ];
    for (const s of summary) {
      ws.mergeCells(`${s.col}11:${s.col}13`);
      const cell = ws.getCell(`${s.col}11`);
      cell.value = s.label;
      cell.alignment = { ...centerMid, textRotation: 90 };
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.color } };
      cell.border = borderAll;
    }

    // ---- Student rows (14..) ----
    let r = 14;
    for (const [idx, student] of course.students.entries()) {
      const row = ws.getRow(r);
      row.height = 18;

      const numCell = ws.getCell(r, 2);
      numCell.value = idx + 1;
      numCell.alignment = centerMid;
      numCell.border = borderAll;
      numCell.font = { bold: true };

      const nameCell = ws.getCell(r, 3);
      const parts = [student.lastName, student.secondLastName ?? '', student.firstName]
        .filter(Boolean)
        .join(' ');
      nameCell.value = parts.toUpperCase();
      nameCell.alignment = { horizontal: 'left', vertical: 'middle' };
      nameCell.border = borderAll;

      let present = 0,
        absent = 0,
        justified = 0,
        late = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const c = 4 + d;
        const date = new Date(year, month - 1, d);
        const dow = date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const cell = ws.getCell(r, c);
        cell.border = borderAll;
        cell.alignment = centerMid;
        cell.font = { size: 9, bold: true };

        if (isWeekend) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
          continue;
        }

        const key = date.toISOString().split('T')[0]!;
        const sym = this.attendanceSymbolFor(student, date, records.get(student.id)?.get(key));
        if (!sym) continue;

        cell.value = sym;
        if (sym === '1') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
          cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
          present++;
        } else if (sym === '0') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
          cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
          absent++;
        } else if (sym === 'J') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
          justified++;
        } else if (sym === 'AT') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
          cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
          late++;
          present++; // late counts as present for attendance %
        }
      }

      const total = present + absent + justified;
      const pct = total > 0 ? present / total : 0;

      const a = ws.getCell(r, 36);
      a.value = present;
      a.alignment = centerMid;
      a.border = borderAll;
      a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

      const b = ws.getCell(r, 37);
      b.value = absent;
      b.alignment = centerMid;
      b.border = borderAll;
      b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };

      const p = ws.getCell(r, 38);
      p.value = pct;
      p.numFmt = '0.0%';
      p.alignment = centerMid;
      p.border = borderAll;
      p.font = { bold: true };
      p.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: pct >= 0.9 ? 'FFE2EFDA' : pct >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };

      const j = ws.getCell(r, 39);
      j.value = justified;
      j.alignment = centerMid;
      j.border = borderAll;
      j.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };

      // silence unused var warning for late (used in present calc)
      void late;

      r++;
    }

    // ---- Legend ----
    r += 2;
    ws.getCell(r, 2).value = 'LEYENDA';
    ws.getCell(r, 2).font = { bold: true, size: 11 };
    r++;
    const legend: Array<[string, string, string]> = [
      ['1', 'Asistencia', GREEN],
      ['0', 'Ausencia', RED],
      ['J', 'Justificación', YELLOW],
      ['AT', 'Atraso', ORANGE],
    ];
    for (const [sym, label, color] of legend) {
      const symC = ws.getCell(r, 2);
      symC.value = sym;
      symC.alignment = centerMid;
      symC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      symC.font = { bold: true, color: { argb: color === YELLOW ? 'FF000000' : 'FFFFFFFF' } };
      symC.border = borderAll;

      ws.getCell(r, 3).value = label;
      ws.getCell(r, 3).font = { size: 10 };
      r++;
    }
  }

  private activeDuringPeriodWhere(from: Date, to: Date) {
    return {
      enrolledAt: { lte: to },
      firstName: { not: '[Eliminado]' },
      OR: [{ withdrawnAt: null }, { withdrawnAt: { gte: from } }],
    };
  }

  private attendanceSymbolFor(
    student: { enrolledAt: Date; withdrawnAt: Date | null },
    date: Date,
    recordedSymbol?: string,
  ): string {
    const current = this.startOfDay(date);
    if (this.startOfDay(student.enrolledAt) > current) return '';
    if (student.withdrawnAt && this.startOfDay(student.withdrawnAt) <= current) return '-';
    return recordedSymbol ?? '';
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
