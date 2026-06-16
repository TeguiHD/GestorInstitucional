import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Injectable } from '@nestjs/common';

import { WITHDRAWAL_REASONS, type WithdrawalReason } from '@asistencia/shared';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { SchoolConfigService, type DateRange } from '../school-config/school-config.service.js';

function formatWithdrawalReason(
  withdrawalReason: WithdrawalReason | string | null | undefined,
  reason: string | null | undefined,
): string {
  if (withdrawalReason) {
    const label = WITHDRAWAL_REASONS[withdrawalReason as WithdrawalReason];
    if (label) {
      return withdrawalReason === 'OTRO' && reason?.trim() ? `${label}: ${reason.trim()}` : label;
    }
  }
  return reason?.trim() || '—';
}

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

export function calculateReportAttendanceRate(attended: number, totalClasses: number): number {
  return totalClasses > 0 ? attended / totalClasses : 0;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly schoolConfig: SchoolConfigService,
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

    // P3: load enrollment events for the period (incorporated and withdrawn students)
    const events = await this.prisma.enrollmentEvent.findMany({
      where: {
        courseId,
        effectiveDate: { gte: from, lte: to },
        status: { in: ['ACTIVE', 'WITHDRAWN', 'RE_ENROLLED', 'TRANSFERRED_IN', 'TRANSFERRED_OUT'] },
        voidedAt: null,
      },
      include: {
        student: { select: { firstName: true, lastName: true, rut: true, enrollmentNumber: true } },
      },
      orderBy: { effectiveDate: 'asc' },
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
      const key = this.schoolConfig.formatDate(r.date);
      if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
      recordMap.get(r.studentId)!.set(key, SYMBOL[r.status] ?? '-');
    }

    const nonSchoolDays = await this.calendar.getNonSchoolDays(course.school.id, from, to);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';
    wb.created = new Date();

    this.buildMonthSheet(wb, {
      course,
      year,
      month,
      to,
      records: recordMap,
      nonSchoolDays,
    });

    // P3: add MINEDUC Control de Subvenciones sheet
    this.buildMovimientosSheet(wb, { course, year, month, from, to, events, nonSchoolDays });

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

    const nonSchoolDays = await this.calendar.getNonSchoolDays(course.school.id, from, to);

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
    const cols = {
      num: { x: 54, w: 24 },
      name: { x: 82, w: 174 },
      rut: { x: 258, w: 60 },
      p: { x: 322, w: 20 },
      a: { x: 344, w: 20 },
      l: { x: 366, w: 24 },
      j: { x: 394, w: 20 },
      attended: { x: 418, w: 32 },
      total: { x: 452, w: 32 },
      rate: { x: 488, w: 56 },
    };
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    doc.text('N°', cols.num.x, y + 5, { width: cols.num.w });
    doc.text('Alumno', cols.name.x, y + 5, { width: cols.name.w });
    doc.text('RUT', cols.rut.x, y + 5, { width: cols.rut.w });
    doc.text('P', cols.p.x, y + 5, { width: cols.p.w, align: 'center' });
    doc.text('A', cols.a.x, y + 5, { width: cols.a.w, align: 'center' });
    doc.text('AT', cols.l.x, y + 5, { width: cols.l.w, align: 'center' });
    doc.text('J', cols.j.x, y + 5, { width: cols.j.w, align: 'center' });
    doc.text('Asist.', cols.attended.x, y + 5, { width: cols.attended.w, align: 'center' });
    doc.text('Total', cols.total.x, y + 5, { width: cols.total.w, align: 'center' });
    doc.text('% Asist.', cols.rate.x, y + 5, { width: cols.rate.w, align: 'center' });
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
      const activeDays = this.countActiveSchoolDays(s, from, to, nonSchoolDays);
      const rate = activeDays > 0 ? (c.p + c.l) / activeDays : 0;
      if (activeDays > 0) {
        totalRate += rate;
        totalStudents++;
      }
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(String(s.enrollmentNumber), cols.num.x, y + 5, { width: cols.num.w });
      doc.text(
        `${s.lastName}${s.secondLastName ? ' ' + s.secondLastName : ''}, ${s.firstName}`,
        cols.name.x,
        y + 5,
        { width: cols.name.w, ellipsis: true },
      );
      doc.text(s.rut, cols.rut.x, y + 5, { width: cols.rut.w });
      doc.text(String(c.p), cols.p.x, y + 5, { width: cols.p.w, align: 'center' });
      doc.text(String(c.a), cols.a.x, y + 5, { width: cols.a.w, align: 'center' });
      doc.text(String(c.l), cols.l.x, y + 5, { width: cols.l.w, align: 'center' });
      doc.text(String(c.j), cols.j.x, y + 5, { width: cols.j.w, align: 'center' });
      doc.text(String(c.p + c.l), cols.attended.x, y + 5, {
        width: cols.attended.w,
        align: 'center',
      });
      doc.text(String(activeDays), cols.total.x, y + 5, { width: cols.total.w, align: 'center' });
      const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(activeDays > 0 ? `${(rate * 100).toFixed(1)}%` : '—', cols.rate.x, y + 5, {
        width: cols.rate.w,
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
    doc.fillColor('#555').font('Helvetica-Oblique').fontSize(8);
    doc.text(
      '% = (Asist. * 100) / Total. Asist. = Presentes + Atrasos; Total = días lectivos trabajados con matrícula activa.',
      48,
      y - 16,
      { width: 499 },
    );

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

    const nonSchoolDays = await this.calendar.getNonSchoolDays(course.school.id, from, to);

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

      const activeDays = this.countActiveSchoolDays(s, from, to, nonSchoolDays);
      const rate = activeDays > 0 ? (p + l) / activeDays : 0;
      if (activeDays > 0) {
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
      doc.text(activeDays > 0 ? `${(rate * 100).toFixed(1)}%` : '—', x, y + 4, {
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
    doc.text(
      'Leyenda: 1 = Presente  ·  0 = Ausente  ·  AT = Atraso  ·  J = Justificado  ·  % = (Presentes + Atrasos) * 100 / Total clases',
      NAV_X,
      y,
    );
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
    const nonSchoolDays = await this.calendar.getNonSchoolDays(course.school.id, start, end);

    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };
    const recordMap = new Map<string, Map<string, string>>();
    for (const r of records) {
      const key = this.schoolConfig.formatDate(r.date);
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
    ws.getColumn(14).width = 11;

    ws.mergeCells('A1:N1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `${course.school.name} — LISTA SEMANAL`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    titleCell.alignment = centerMid;
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:N2');
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
      'Total clases',
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
        const key = this.schoolConfig.formatDate(d);
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

      const activeDays = this.countActiveSchoolDays(student, start, end, nonSchoolDays);
      const pct = calculateReportAttendanceRate(present, activeDays);
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
      ws.getCell(r, 14).value = activeDays;
      ws.getCell(r, 14).border = borderAll;
      ws.getCell(r, 14).alignment = centerMid;
      ws.getCell(r, 14).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    });

    const formulaRow = course.students.length + 5;
    ws.mergeCells(`A${formulaRow}:N${formulaRow}`);
    const formulaCell = ws.getCell(formulaRow, 1);
    formulaCell.value =
      '% = (Presentes + Atrasos) * 100 / Total clases. Justificados y sin registro no suman asistencia.';
    formulaCell.font = { italic: true, size: 9, color: { argb: 'FF666666' } };
    formulaCell.alignment = { horizontal: 'left', vertical: 'middle' };

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
    const courseHead = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const semesterNumber = this.toSemesterNumber(semester);
    const period = await this.schoolConfig.getSemesterPeriod(
      courseHead.schoolId,
      year,
      semesterNumber,
    );
    const ranges = period.ranges;
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.schoolConfig.activeDuringRangesWhere(ranges),
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
      where: { courseId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
      select: { studentId: true, date: true, status: true },
    });
    const byMonth = new Map<number, Array<{ studentId: string; date: Date; status: string }>>();
    for (const r of allRecords) {
      const m = r.date.getMonth() + 1;
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(r);
    }

    const allEvents = await this.prisma.enrollmentEvent.findMany({
      where: {
        courseId,
        ...this.schoolConfig.enrollmentWhereForRanges(ranges),
        status: { in: ['ACTIVE', 'WITHDRAWN', 'RE_ENROLLED', 'TRANSFERRED_IN', 'TRANSFERRED_OUT'] },
        voidedAt: null,
      },
      include: {
        student: { select: { firstName: true, lastName: true, rut: true, enrollmentNumber: true } },
      },
      orderBy: { effectiveDate: 'asc' },
    });

    for (const monthRange of monthRanges) {
      const { month, from, to } = monthRange;
      const records = (byMonth.get(month) ?? []).filter((record) =>
        this.schoolConfig.isDateInRanges(record.date, [monthRange]),
      );
      const recordMap = new Map<string, Map<string, string>>();
      for (const r of records) {
        const key = this.schoolConfig.formatDate(r.date);
        if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
        recordMap.get(r.studentId)!.set(key, SYMBOL[r.status] ?? '-');
      }
      this.buildMonthSheet(wb, {
        course,
        year,
        month,
        from,
        to,
        records: recordMap,
        nonSchoolDays,
      });

      // Add monthly control subvenciones sheet for each month
      const monthEvents = allEvents.filter((e) =>
        this.schoolConfig.isDateInRanges(e.effectiveDate, [monthRange]),
      );
      this.buildMovimientosSheet(wb, {
        course,
        year,
        month,
        from,
        to,
        events: monthEvents,
        nonSchoolDays,
      });

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
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 10;
    ws.getColumn(7).width = 9;

    ws.mergeCells('A1:G1');
    ws.getCell('A1').value =
      `${course.school.name} — RESUMEN SEMESTRE ${semester} ${year} — ${course.name}`;
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell('A1').alignment = centerMid;
    ws.getRow(1).height = 22;

    ['Nº', 'Alumno', 'Asist.', 'Ausent.', 'Total clases', '% Asist.', 'Justif.'].forEach((h, i) => {
      const c = ws.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.alignment = centerMid;
      c.border = borderAll;
    });

    let rowIdx = 0;
    course.students.forEach((student) => {
      const r = rowIdx + 3;
      const e = summary.get(student.id) ?? { p: 0, a: 0, j: 0 };
      // P2 FIX: denominator = active school days over the whole semester period
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        ranges,
        nonSchoolDays,
      );
      const pct = activeDays > 0 ? e.p / activeDays : 0;
      // P2: use real enrollmentNumber
      ws.getCell(r, 1).value = student.enrollmentNumber;
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
      ws.getCell(r, 5).value = activeDays;
      ws.getCell(r, 5).border = borderAll;
      ws.getCell(r, 5).alignment = centerMid;
      ws.getCell(r, 5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
      const pctCell = ws.getCell(r, 6);
      pctCell.value = pct;
      pctCell.numFmt = '0.0%';
      pctCell.border = borderAll;
      pctCell.alignment = centerMid;
      pctCell.font = { bold: true };
      pctCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: pct >= 0.85 ? 'FFE2EFDA' : pct >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };
      ws.getCell(r, 7).value = e.j;
      ws.getCell(r, 7).border = borderAll;
      ws.getCell(r, 7).alignment = centerMid;
      ws.getCell(r, 7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      rowIdx++;
    });

    const formulaRow = course.students.length + 4;
    ws.mergeCells(`A${formulaRow}:G${formulaRow}`);
    ws.getCell(formulaRow, 1).value =
      '% = (Asist. * 100) / Total clases. Asist. = Presentes + Atrasos.';
    ws.getCell(formulaRow, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

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
    const courseHead = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const period = await this.schoolConfig.getAnnualPeriod(courseHead.schoolId, year);
    const ranges = period.ranges;
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.schoolConfig.activeDuringRangesWhere(ranges),
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
      where: { courseId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
      select: { studentId: true, date: true, status: true },
    });
    const byMonth = new Map<number, Array<{ studentId: string; date: Date; status: string }>>();
    for (const r of allRecords) {
      const m = r.date.getMonth() + 1;
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(r);
    }

    for (const monthRange of monthRanges) {
      const { month, from, to } = monthRange;
      const records = (byMonth.get(month) ?? []).filter((record) =>
        this.schoolConfig.isDateInRanges(record.date, [monthRange]),
      );
      const recordMap = new Map<string, Map<string, string>>();
      for (const r of records) {
        const key = this.schoolConfig.formatDate(r.date);
        if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
        recordMap.get(r.studentId)!.set(key, SYMBOL[r.status] ?? '-');
      }
      this.buildMonthSheet(wb, {
        course,
        year,
        month,
        from,
        to,
        records: recordMap,
        nonSchoolDays,
      });

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
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 10;
    ws.getColumn(7).width = 9;

    ws.mergeCells('A1:G1');
    ws.getCell('A1').value = `${course.school.name} — RESUMEN ANUAL ${year} — ${course.name}`;
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell('A1').alignment = centerMid;
    ws.getRow(1).height = 22;

    ['Nº', 'Alumno', 'Asist.', 'Ausent.', 'Total clases', '% Asist.', 'Justif.'].forEach((h, i) => {
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
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        ranges,
        nonSchoolDays,
      );
      const pct = activeDays > 0 ? e.p / activeDays : 0;
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
      ws.getCell(r, 5).value = activeDays;
      ws.getCell(r, 5).border = borderAll;
      ws.getCell(r, 5).alignment = centerMid;
      ws.getCell(r, 5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
      const pctCell = ws.getCell(r, 6);
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
      ws.getCell(r, 7).value = e.j;
      ws.getCell(r, 7).border = borderAll;
      ws.getCell(r, 7).alignment = centerMid;
      ws.getCell(r, 7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    });

    const formulaRow = course.students.length + 4;
    ws.mergeCells(`A${formulaRow}:G${formulaRow}`);
    ws.getCell(formulaRow, 1).value =
      '% = (Asist. * 100) / Total clases. Asist. = Presentes + Atrasos.';
    ws.getCell(formulaRow, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

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
    const courseHead = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const semesterNumber = this.toSemesterNumber(semester);
    const period = await this.schoolConfig.getSemesterPeriod(
      courseHead.schoolId,
      year,
      semesterNumber,
    );
    const ranges = period.ranges;
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);
    const semLabel = semester === 1 ? '1er Semestre' : '2do Semestre';

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.schoolConfig.activeDuringRangesWhere(ranges),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const perStudent = new Map<string, { p: number; a: number; l: number; j: number }>();
    for (const s of course.students) perStudent.set(s.id, { p: 0, a: 0, l: 0, j: 0 });

    // Single query for all semester months
    const allSemRecords = await this.prisma.attendanceRecord.findMany({
      where: { courseId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
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
      .text(`Período: ${this.periodLabel(ranges)}`, 48, 162)
      .text(
        `Meses: ${monthRanges.map((range) => MONTH_NAMES_ES[range.month - 1]).join(', ')}`,
        48,
        176,
      );

    let y = 204;
    const rowH = 18;
    const cols = {
      num: { x: 54, w: 24 },
      name: { x: 82, w: 174 },
      rut: { x: 258, w: 60 },
      p: { x: 322, w: 20 },
      a: { x: 344, w: 20 },
      l: { x: 366, w: 24 },
      j: { x: 394, w: 20 },
      attended: { x: 418, w: 32 },
      total: { x: 452, w: 32 },
      rate: { x: 488, w: 56 },
    };
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    doc.text('N°', cols.num.x, y + 5, { width: cols.num.w });
    doc.text('Alumno', cols.name.x, y + 5, { width: cols.name.w });
    doc.text('RUT', cols.rut.x, y + 5, { width: cols.rut.w });
    doc.text('P', cols.p.x, y + 5, { width: cols.p.w, align: 'center' });
    doc.text('A', cols.a.x, y + 5, { width: cols.a.w, align: 'center' });
    doc.text('AT', cols.l.x, y + 5, { width: cols.l.w, align: 'center' });
    doc.text('J', cols.j.x, y + 5, { width: cols.j.w, align: 'center' });
    doc.text('Asist.', cols.attended.x, y + 5, { width: cols.attended.w, align: 'center' });
    doc.text('Total', cols.total.x, y + 5, { width: cols.total.w, align: 'center' });
    doc.text('% Asist.', cols.rate.x, y + 5, { width: cols.rate.w, align: 'center' });
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
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(s, ranges, nonSchoolDays);
      const rate = activeDays > 0 ? (c.p + c.l) / activeDays : 0;
      if (activeDays > 0) {
        totalRate += rate;
        totalStudents++;
      }
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(String(s.enrollmentNumber), cols.num.x, y + 5, { width: cols.num.w });
      doc.text(
        `${s.lastName}${s.secondLastName ? ' ' + s.secondLastName : ''}, ${s.firstName}`,
        cols.name.x,
        y + 5,
        { width: cols.name.w, ellipsis: true },
      );
      doc.text(s.rut, cols.rut.x, y + 5, { width: cols.rut.w });
      doc.text(String(c.p), cols.p.x, y + 5, { width: cols.p.w, align: 'center' });
      doc.text(String(c.a), cols.a.x, y + 5, { width: cols.a.w, align: 'center' });
      doc.text(String(c.l), cols.l.x, y + 5, { width: cols.l.w, align: 'center' });
      doc.text(String(c.j), cols.j.x, y + 5, { width: cols.j.w, align: 'center' });
      doc.text(String(c.p + c.l), cols.attended.x, y + 5, {
        width: cols.attended.w,
        align: 'center',
      });
      doc.text(String(activeDays), cols.total.x, y + 5, { width: cols.total.w, align: 'center' });
      const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(activeDays > 0 ? `${(rate * 100).toFixed(1)}%` : '—', cols.rate.x, y + 5, {
        width: cols.rate.w,
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
    doc.fillColor('#555').font('Helvetica-Oblique').fontSize(8);
    doc.text(
      '% = (Asist. * 100) / Total. Asist. = Presentes + Atrasos; Total = días lectivos trabajados con matrícula activa.',
      48,
      y - 16,
      { width: 499 },
    );
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
    const courseHead = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const period = await this.schoolConfig.getAnnualPeriod(courseHead.schoolId, year);
    const ranges = period.ranges;
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.schoolConfig.activeDuringRangesWhere(ranges),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const perStudent = new Map<string, { p: number; a: number; l: number; j: number }>();
    for (const s of course.students) perStudent.set(s.id, { p: 0, a: 0, l: 0, j: 0 });

    // Single query for entire year
    const allAnnualRecords = await this.prisma.attendanceRecord.findMany({
      where: { courseId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
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
      .text(`Periodo: ${this.periodLabel(ranges)}`, 48, 162);

    let y = 190;
    const rowH = 18;
    const cols = {
      num: { x: 54, w: 24 },
      name: { x: 82, w: 174 },
      rut: { x: 258, w: 60 },
      p: { x: 322, w: 20 },
      a: { x: 344, w: 20 },
      l: { x: 366, w: 24 },
      j: { x: 394, w: 20 },
      attended: { x: 418, w: 32 },
      total: { x: 452, w: 32 },
      rate: { x: 488, w: 56 },
    };
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    doc.text('N°', cols.num.x, y + 5, { width: cols.num.w });
    doc.text('Alumno', cols.name.x, y + 5, { width: cols.name.w });
    doc.text('RUT', cols.rut.x, y + 5, { width: cols.rut.w });
    doc.text('P', cols.p.x, y + 5, { width: cols.p.w, align: 'center' });
    doc.text('A', cols.a.x, y + 5, { width: cols.a.w, align: 'center' });
    doc.text('AT', cols.l.x, y + 5, { width: cols.l.w, align: 'center' });
    doc.text('J', cols.j.x, y + 5, { width: cols.j.w, align: 'center' });
    doc.text('Asist.', cols.attended.x, y + 5, { width: cols.attended.w, align: 'center' });
    doc.text('Total', cols.total.x, y + 5, { width: cols.total.w, align: 'center' });
    doc.text('% Asist.', cols.rate.x, y + 5, { width: cols.rate.w, align: 'center' });
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
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(s, ranges, nonSchoolDays);
      const rate = activeDays > 0 ? (c.p + c.l) / activeDays : 0;
      if (activeDays > 0) {
        totalRate += rate;
        totalStudents++;
      }
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(String(s.enrollmentNumber), cols.num.x, y + 5, { width: cols.num.w });
      doc.text(
        `${s.lastName}${s.secondLastName ? ' ' + s.secondLastName : ''}, ${s.firstName}`,
        cols.name.x,
        y + 5,
        { width: cols.name.w, ellipsis: true },
      );
      doc.text(s.rut, cols.rut.x, y + 5, { width: cols.rut.w });
      doc.text(String(c.p), cols.p.x, y + 5, { width: cols.p.w, align: 'center' });
      doc.text(String(c.a), cols.a.x, y + 5, { width: cols.a.w, align: 'center' });
      doc.text(String(c.l), cols.l.x, y + 5, { width: cols.l.w, align: 'center' });
      doc.text(String(c.j), cols.j.x, y + 5, { width: cols.j.w, align: 'center' });
      doc.text(String(c.p + c.l), cols.attended.x, y + 5, {
        width: cols.attended.w,
        align: 'center',
      });
      doc.text(String(activeDays), cols.total.x, y + 5, { width: cols.total.w, align: 'center' });
      const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(activeDays > 0 ? `${(rate * 100).toFixed(1)}%` : '—', cols.rate.x, y + 5, {
        width: cols.rate.w,
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
    doc.fillColor('#555').font('Helvetica-Oblique').fontSize(8);
    doc.text(
      '% = (Asist. * 100) / Total. Asist. = Presentes + Atrasos; Total = días lectivos trabajados con matrícula activa.',
      48,
      y - 16,
      { width: 499 },
    );
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

  async generateStudentMonthlyPdf(
    studentId: string,
    year: number,
    month: number,
    requestedById: string,
  ): Promise<Buffer> {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);

    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        course: {
          include: {
            school: true,
            teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
          },
        },
      },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, date: { gte: from, lte: to } },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const daysInMonth = to.getDate();
    let p = 0,
      a = 0,
      l = 0,
      j = 0;
    for (const r of records) {
      if (r.status === 'PRESENT') p++;
      else if (r.status === 'ABSENT') a++;
      else if (r.status === 'LATE') l++;
      else if (r.status === 'JUSTIFIED') j++;
    }

    const nonSchoolDays = await this.calendar.getNonSchoolDays(student.course.school.id, from, to);
    const activeDays = this.countActiveSchoolDays(student, from, to, nonSchoolDays);
    const attendedDays = p + l;
    const rate = calculateReportAttendanceRate(attendedDays, activeDays);

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
      .text(student.course.school.name.toUpperCase(), 120, 48, { align: 'left' });
    doc
      .fontSize(11)
      .fillColor('#333')
      .font('Helvetica')
      .text('CERTIFICADO DE ASISTENCIA INDIVIDUAL', 120, 70);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 120, 86);

    doc.moveTo(48, 115).lineTo(547, 115).strokeColor('#1F4E79').lineWidth(1.2).stroke();

    const monthName = MONTH_NAMES_ES[month - 1] ?? '';
    const head = student.course.teachers[0]?.user;
    doc.fontSize(13).fillColor('#000').font('Helvetica-Bold').text(`${monthName} ${year}`, 48, 128);
    doc
      .fontSize(10)
      .fillColor('#555')
      .font('Helvetica')
      .text(`Curso: ${student.course.name}`, 48, 148)
      .text(`Profesor jefe: ${head ? `${head.firstName} ${head.lastName}` : '—'}`, 48, 162);

    let y = 190;
    doc.rect(48, y, 499, 60).fill('#F5F8FB');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    doc.text('DATOS DEL ESTUDIANTE', 56, y + 8);
    doc.font('Helvetica').fontSize(9);
    doc.text(
      `Nombre: ${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`,
      56,
      y + 24,
    );
    doc.text(`RUT: ${student.rut}`, 56, y + 38);
    doc.text(`N° Lista: ${student.enrollmentNumber}`, 300, y + 24);
    doc.text(`Total clases: ${activeDays}`, 300, y + 38);
    y += 76;

    const rowH = 18;
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('Día', 54, y + 5, { width: 40 });
    doc.text('Día semana', 100, y + 5, { width: 80 });
    doc.text('Estado', 186, y + 5, { width: 120 });
    doc.text('Símbolo', 312, y + 5, { width: 60, align: 'center' });
    y += rowH;

    doc.font('Helvetica').fontSize(9).fillColor('#000');
    const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const STATUS_LABELS: Record<string, { label: string; color: string }> = {
      PRESENT: { label: 'Presente', color: '#16A34A' },
      ABSENT: { label: 'Ausente', color: '#DC2626' },
      LATE: { label: 'Atraso', color: '#EA580C' },
      JUSTIFIED: { label: 'Justificado', color: '#FACC15' },
    };

    for (let d = 1; d <= daysInMonth; d++) {
      if (y > 720) {
        doc.addPage();
        y = 60;
      }
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const record = records.find((r) => r.date.getDate() === d);

      const band = d % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');

      if (isWeekend) {
        doc.rect(48, y, 499, rowH).fill('#E8EDF1');
        doc.fillColor('#666').text(String(d), 54, y + 5, { width: 40 });
        doc.text(DOW_NAMES[dow] ?? '', 100, y + 5, { width: 80 });
        doc.text('—', 186, y + 5, { width: 120 });
        doc.text('—', 312, y + 5, { width: 60, align: 'center' });
      } else if (record) {
        const cfg = STATUS_LABELS[record.status];
        doc.text(String(d), 54, y + 5, { width: 40 });
        doc.text(DOW_NAMES[dow] ?? '', 100, y + 5, { width: 80 });
        doc.fillColor(cfg?.color ?? '#000').font('Helvetica-Bold');
        doc.text(cfg?.label ?? record.status, 186, y + 5, { width: 120 });
        doc.font('Helvetica');
        doc.fillColor('#000');
        const sym =
          record.status === 'PRESENT'
            ? '1'
            : record.status === 'ABSENT'
              ? '0'
              : record.status === 'LATE'
                ? 'AT'
                : 'J';
        doc.text(sym, 312, y + 5, { width: 60, align: 'center' });
      } else {
        doc.text(String(d), 54, y + 5, { width: 40 });
        doc.text(DOW_NAMES[dow] ?? '', 100, y + 5, { width: 80 });
        doc.fillColor('#999').text('Sin registro', 186, y + 5, { width: 120 });
        doc.text('—', 312, y + 5, { width: 60, align: 'center' });
      }
      doc.fillColor('#000').font('Helvetica');
      y += rowH;
    }

    y += 16;
    if (y > 680) {
      doc.addPage();
      y = 80;
    }
    doc.rect(48, y, 499, 104).fill('#DCE6F1');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(11);
    doc.text('RESUMEN ESTADÍSTICO', 56, y + 8);
    doc.font('Helvetica').fontSize(10).fillColor('#000');
    doc.text(`Presentes (P): ${p}`, 56, y + 28);
    doc.text(`Ausentes (A): ${a}`, 56, y + 44);
    doc.text(`Atrasos (AT): ${l}`, 220, y + 28);
    doc.text(`Justificados (J): ${j}`, 220, y + 44);
    doc.text(`Días asistidos (P+AT): ${attendedDays}`, 56, y + 64);
    doc.text(`Total clases: ${activeDays}`, 220, y + 64);
    doc
      .fontSize(8)
      .fillColor('#555')
      .text(`Fórmula: ${attendedDays} * 100 / ${activeDays}`, 56, y + 82, { width: 260 });
    const rateColor = rate >= 0.9 ? '#15803d' : rate >= 0.7 ? '#b45309' : '#b91c1c';
    doc.fillColor(rateColor).font('Helvetica-Bold').fontSize(14);
    doc.text(`${(rate * 100).toFixed(1)}%`, 400, y + 32, { width: 100, align: 'center' });
    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text('Asistencia', 400, y + 52, { width: 100, align: 'center' });
    y += 120;

    if (y > 720) {
      doc.addPage();
      y = 80;
    }
    doc
      .fontSize(8)
      .fillColor('#555')
      .font('Helvetica-Oblique')
      .text(
        'Documento emitido conforme al Decreto 67/2018 del MINEDUC y Ley 19.799 (FES). ' +
          'El porcentaje se calcula como (Presentes + Atrasos) * 100 / Total clases con matrícula activa.',
        48,
        y,
        { width: 499 },
      );
    y += 40;

    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text('_______________________________________', 80, y + 40);
    doc.text('_______________________________________', 340, y + 40);
    doc.text('Profesor Jefe', 130, y + 55);
    doc.text('Director/a', 400, y + 55);

    doc
      .fontSize(7)
      .fillColor('#999')
      .text(
        `Documento generado automáticamente — ${student.course.school.name} · ${new Date().toISOString()}`,
        48,
        800,
        { width: 499, align: 'center' },
      );

    doc.end();
    await done;

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Student',
      entityId: studentId,
      meta: { year, month, format: 'student_monthly_pdf' },
    });

    return Buffer.concat(chunks);
  }

  async generateStudentSemesterPdf(
    studentId: string,
    year: number,
    semester: number,
    requestedById: string,
  ): Promise<Buffer> {
    const semLabel = semester === 1 ? '1er Semestre' : '2do Semestre';
    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        course: {
          include: {
            school: true,
            teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
          },
        },
      },
    });
    const semesterNumber = this.toSemesterNumber(semester);
    const period = await this.schoolConfig.getSemesterPeriod(
      student.course.schoolId,
      year,
      semesterNumber,
    );
    const ranges = period.ranges;
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      student.course.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const byMonth = new Map<number, { p: number; a: number; l: number; j: number }>();
    for (const range of monthRanges) byMonth.set(range.month, { p: 0, a: 0, l: 0, j: 0 });
    for (const r of records) {
      const m = r.date.getMonth() + 1;
      const e = byMonth.get(m);
      if (!e) continue;
      if (r.status === 'PRESENT') e.p++;
      else if (r.status === 'ABSENT') e.a++;
      else if (r.status === 'LATE') e.l++;
      else if (r.status === 'JUSTIFIED') e.j++;
    }

    let totalP = 0,
      totalA = 0,
      totalL = 0,
      totalJ = 0;
    for (const e of byMonth.values()) {
      totalP += e.p;
      totalA += e.a;
      totalL += e.l;
      totalJ += e.j;
    }
    const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
      student,
      ranges,
      nonSchoolDays,
    );
    const attendedDays = totalP + totalL;
    const rate = calculateReportAttendanceRate(attendedDays, activeDays);

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
      .text(student.course.school.name.toUpperCase(), 120, 48, { align: 'left' });
    doc
      .fontSize(11)
      .fillColor('#333')
      .font('Helvetica')
      .text(`CERTIFICADO DE ASISTENCIA INDIVIDUAL — ${semLabel} ${year}`, 120, 70);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 120, 86);
    doc.moveTo(48, 115).lineTo(547, 115).strokeColor('#1F4E79').lineWidth(1.2).stroke();

    const head = student.course.teachers[0]?.user;
    doc
      .fontSize(13)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .text(`${student.course.name} — ${semLabel} ${year}`, 48, 128);
    doc
      .fontSize(10)
      .fillColor('#555')
      .font('Helvetica')
      .text(`Profesor jefe: ${head ? `${head.firstName} ${head.lastName}` : '—'}`, 48, 148);

    let y = 176;
    doc.rect(48, y, 499, 46).fill('#F5F8FB');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    doc.text('DATOS DEL ESTUDIANTE', 56, y + 8);
    doc.font('Helvetica').fontSize(9);
    doc.text(
      `Nombre: ${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`,
      56,
      y + 24,
    );
    doc.text(`RUT: ${student.rut}`, 300, y + 24);
    y += 62;

    const rowH = 18;
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    doc.text('Mes', 54, y + 5, { width: 98 });
    doc.text('P', 158, y + 5, { width: 28, align: 'center' });
    doc.text('A', 190, y + 5, { width: 28, align: 'center' });
    doc.text('AT', 222, y + 5, { width: 30, align: 'center' });
    doc.text('J', 256, y + 5, { width: 28, align: 'center' });
    doc.text('Asist.', 288, y + 5, { width: 42, align: 'center' });
    doc.text('Total', 334, y + 5, { width: 42, align: 'center' });
    doc.text('% Asist.', 382, y + 5, { width: 74, align: 'center' });
    y += rowH;

    doc.font('Helvetica').fontSize(9).fillColor('#000');
    for (const [i, monthRange] of monthRanges.entries()) {
      const m = monthRange.month;
      const e = byMonth.get(m)!;
      const monthActiveDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        [monthRange],
        nonSchoolDays,
      );
      const monthRate = calculateReportAttendanceRate(e.p + e.l, monthActiveDays);
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(MONTH_NAMES_ES[m - 1] ?? '', 54, y + 5, { width: 98 });
      doc.text(String(e.p), 158, y + 5, { width: 28, align: 'center' });
      doc.text(String(e.a), 190, y + 5, { width: 28, align: 'center' });
      doc.text(String(e.l), 222, y + 5, { width: 30, align: 'center' });
      doc.text(String(e.j), 256, y + 5, { width: 28, align: 'center' });
      doc.text(String(e.p + e.l), 288, y + 5, { width: 42, align: 'center' });
      doc.text(String(monthActiveDays), 334, y + 5, { width: 42, align: 'center' });
      const rateColor = monthRate >= 0.9 ? '#15803d' : monthRate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(monthActiveDays > 0 ? `${(monthRate * 100).toFixed(1)}%` : '—', 382, y + 5, {
        width: 74,
        align: 'center',
      });
      doc.fillColor('#000').font('Helvetica');
      y += rowH;
    }

    y += 10;
    doc.rect(48, y, 499, 24).fill('#DCE6F1');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(10);
    doc.text(`Asistencia promedio semestral: ${(rate * 100).toFixed(1)}%`, 54, y + 7);
    y += 40;

    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text(`Total Presentes: ${totalP}`, 56, y);
    doc.text(`Total Ausentes: ${totalA}`, 56, y + 14);
    doc.text(`Total Atrasos: ${totalL}`, 220, y);
    doc.text(`Total Justificados: ${totalJ}`, 220, y + 14);
    doc.text(`Días asistidos (P+AT): ${attendedDays}`, 56, y + 32);
    doc.text(`Total clases: ${activeDays}`, 220, y + 32);
    doc
      .fontSize(8)
      .fillColor('#555')
      .text(`Fórmula: ${attendedDays} * 100 / ${activeDays}`, 56, y + 48, { width: 260 });
    y += 66;

    if (y > 720) {
      doc.addPage();
      y = 80;
    }
    doc
      .fontSize(8)
      .fillColor('#555')
      .font('Helvetica-Oblique')
      .text(
        'Documento emitido conforme al Decreto 67/2018 del MINEDUC y Ley 19.799 (FES). ' +
          'El porcentaje se calcula como (Presentes + Atrasos) * 100 / Total clases con matrícula activa.',
        48,
        y,
        { width: 499 },
      );
    y += 40;

    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text('_______________________________________', 80, y + 40);
    doc.text('_______________________________________', 340, y + 40);
    doc.text('Profesor Jefe', 130, y + 55);
    doc.text('Director/a', 400, y + 55);

    doc
      .fontSize(7)
      .fillColor('#999')
      .text(
        `Documento generado automáticamente — ${student.course.school.name} · ${new Date().toISOString()}`,
        48,
        800,
        { width: 499, align: 'center' },
      );

    doc.end();
    await done;

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Student',
      entityId: studentId,
      meta: { year, semester, format: 'student_semester_pdf' },
    });

    return Buffer.concat(chunks);
  }

  async generateStudentAnnualPdf(
    studentId: string,
    year: number,
    requestedById: string,
  ): Promise<Buffer> {
    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        course: {
          include: {
            school: true,
            teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
          },
        },
      },
    });
    const period = await this.schoolConfig.getAnnualPeriod(student.course.schoolId, year);
    const ranges = period.ranges;
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      student.course.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const byMonth = new Map<number, { p: number; a: number; l: number; j: number }>();
    for (const range of monthRanges) byMonth.set(range.month, { p: 0, a: 0, l: 0, j: 0 });
    for (const r of records) {
      const m = r.date.getMonth() + 1;
      const e = byMonth.get(m);
      if (!e) continue;
      if (r.status === 'PRESENT') e.p++;
      else if (r.status === 'ABSENT') e.a++;
      else if (r.status === 'LATE') e.l++;
      else if (r.status === 'JUSTIFIED') e.j++;
    }

    let totalP = 0,
      totalA = 0,
      totalL = 0,
      totalJ = 0;
    for (const e of byMonth.values()) {
      totalP += e.p;
      totalA += e.a;
      totalL += e.l;
      totalJ += e.j;
    }
    const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
      student,
      ranges,
      nonSchoolDays,
    );
    const attendedDays = totalP + totalL;
    const rate = calculateReportAttendanceRate(attendedDays, activeDays);

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
      .text(student.course.school.name.toUpperCase(), 120, 48, { align: 'left' });
    doc
      .fontSize(11)
      .fillColor('#333')
      .font('Helvetica')
      .text(`CERTIFICADO DE ASISTENCIA INDIVIDUAL — ${year}`, 120, 70);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text(`Emitido: ${new Date().toLocaleDateString('es-CL')}`, 120, 86);
    doc.moveTo(48, 115).lineTo(547, 115).strokeColor('#1F4E79').lineWidth(1.2).stroke();

    const head = student.course.teachers[0]?.user;
    doc
      .fontSize(13)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .text(`${student.course.name} — ${year}`, 48, 128);
    doc
      .fontSize(10)
      .fillColor('#555')
      .font('Helvetica')
      .text(`Profesor jefe: ${head ? `${head.firstName} ${head.lastName}` : '—'}`, 48, 148);

    let y = 176;
    doc.rect(48, y, 499, 46).fill('#F5F8FB');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    doc.text('DATOS DEL ESTUDIANTE', 56, y + 8);
    doc.font('Helvetica').fontSize(9);
    doc.text(
      `Nombre: ${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`,
      56,
      y + 24,
    );
    doc.text(`RUT: ${student.rut}`, 300, y + 24);
    y += 62;

    const rowH = 18;
    doc.rect(48, y, 499, rowH).fill('#1F4E79');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    doc.text('Mes', 54, y + 5, { width: 98 });
    doc.text('P', 158, y + 5, { width: 28, align: 'center' });
    doc.text('A', 190, y + 5, { width: 28, align: 'center' });
    doc.text('AT', 222, y + 5, { width: 30, align: 'center' });
    doc.text('J', 256, y + 5, { width: 28, align: 'center' });
    doc.text('Asist.', 288, y + 5, { width: 42, align: 'center' });
    doc.text('Total', 334, y + 5, { width: 42, align: 'center' });
    doc.text('% Asist.', 382, y + 5, { width: 74, align: 'center' });
    y += rowH;

    doc.font('Helvetica').fontSize(9).fillColor('#000');
    for (const [i, monthRange] of monthRanges.entries()) {
      const m = monthRange.month;
      if (y > 740) {
        doc.addPage();
        y = 60;
      }
      const e = byMonth.get(m)!;
      const monthActiveDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        [monthRange],
        nonSchoolDays,
      );
      const monthRate = calculateReportAttendanceRate(e.p + e.l, monthActiveDays);
      const band = i % 2 === 0 ? '#F5F8FB' : '#FFFFFF';
      doc.rect(48, y, 499, rowH).fill(band);
      doc.fillColor('#000');
      doc.text(MONTH_NAMES_ES[m - 1] ?? '', 54, y + 5, { width: 98 });
      doc.text(String(e.p), 158, y + 5, { width: 28, align: 'center' });
      doc.text(String(e.a), 190, y + 5, { width: 28, align: 'center' });
      doc.text(String(e.l), 222, y + 5, { width: 30, align: 'center' });
      doc.text(String(e.j), 256, y + 5, { width: 28, align: 'center' });
      doc.text(String(e.p + e.l), 288, y + 5, { width: 42, align: 'center' });
      doc.text(String(monthActiveDays), 334, y + 5, { width: 42, align: 'center' });
      const rateColor = monthRate >= 0.9 ? '#15803d' : monthRate >= 0.7 ? '#b45309' : '#b91c1c';
      doc.fillColor(rateColor).font('Helvetica-Bold');
      doc.text(monthActiveDays > 0 ? `${(monthRate * 100).toFixed(1)}%` : '—', 382, y + 5, {
        width: 74,
        align: 'center',
      });
      doc.fillColor('#000').font('Helvetica');
      y += rowH;
    }

    y += 10;
    doc.rect(48, y, 499, 24).fill('#DCE6F1');
    doc.fillColor('#1F4E79').font('Helvetica-Bold').fontSize(10);
    doc.text(`Asistencia promedio anual: ${(rate * 100).toFixed(1)}%`, 54, y + 7);
    y += 40;

    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text(`Total Presentes: ${totalP}`, 56, y);
    doc.text(`Total Ausentes: ${totalA}`, 56, y + 14);
    doc.text(`Total Atrasos: ${totalL}`, 220, y);
    doc.text(`Total Justificados: ${totalJ}`, 220, y + 14);
    doc.text(`Días asistidos (P+AT): ${attendedDays}`, 56, y + 32);
    doc.text(`Total clases: ${activeDays}`, 220, y + 32);
    doc
      .fontSize(8)
      .fillColor('#555')
      .text(`Fórmula: ${attendedDays} * 100 / ${activeDays}`, 56, y + 48, { width: 260 });
    y += 66;

    if (y > 720) {
      doc.addPage();
      y = 80;
    }
    doc
      .fontSize(8)
      .fillColor('#555')
      .font('Helvetica-Oblique')
      .text(
        'Documento emitido conforme al Decreto 67/2018 del MINEDUC y Ley 19.799 (FES). ' +
          'El porcentaje se calcula como (Presentes + Atrasos) * 100 / Total clases con matrícula activa.',
        48,
        y,
        { width: 499 },
      );
    y += 40;

    doc.fillColor('#000').font('Helvetica').fontSize(9);
    doc.text('_______________________________________', 80, y + 40);
    doc.text('_______________________________________', 340, y + 40);
    doc.text('Profesor Jefe', 130, y + 55);
    doc.text('Director/a', 400, y + 55);

    doc
      .fontSize(7)
      .fillColor('#999')
      .text(
        `Documento generado automáticamente — ${student.course.school.name} · ${new Date().toISOString()}`,
        48,
        800,
        { width: 499, align: 'center' },
      );

    doc.end();
    await done;

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Student',
      entityId: studentId,
      meta: { year, format: 'student_annual_pdf' },
    });

    return Buffer.concat(chunks);
  }

  async generateStudentMonthlyExcel(
    studentId: string,
    year: number,
    month: number,
    requestedById: string,
  ): Promise<Buffer> {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);

    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        course: {
          include: {
            school: true,
            teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
          },
        },
      },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, date: { gte: from, lte: to } },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const daysInMonth = to.getDate();
    const recordMap = new Map<number, string>();
    for (const r of records) {
      recordMap.set(r.date.getDate(), r.status);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';
    wb.created = new Date();

    const ws = wb.addWorksheet('ASISTENCIA', { views: [{ showGridLines: false }] });
    const BLUE = 'FF1F4E79';
    const GREEN = 'FF00B050';
    const RED = 'FFC00000';
    const YELLOW = 'FFFFFF00';
    const ORANGE = 'FFED7D31';
    const GRAY = 'FFD9D9D9';
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    const centerMid = { horizontal: 'center' as const, vertical: 'middle' as const };

    ws.getColumn(1).width = 8;
    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 10;
    ws.getColumn(5).width = 12;

    ws.mergeCells('A1:E1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `${student.course.school.name.toUpperCase()} — ASISTENCIA INDIVIDUAL`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    titleCell.alignment = centerMid;
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:E2');
    const monthName = MONTH_NAMES_ES[month - 1] ?? '';
    ws.getCell('A2').value = `${student.course.name} — ${monthName} ${year}`;
    ws.getCell('A2').alignment = centerMid;
    ws.getCell('A2').font = { bold: true, size: 11 };
    ws.getRow(2).height = 18;

    let r = 4;
    ws.getCell(r, 1).value = 'Estudiante:';
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 2, r, 5);
    ws.getCell(r, 2).value =
      `${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`;
    r++;
    ws.getCell(r, 1).value = 'RUT:';
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = student.rut;
    ws.getCell(r, 3).value = 'N° Lista:';
    ws.getCell(r, 3).font = { bold: true };
    ws.getCell(r, 4).value = student.enrollmentNumber;
    r += 2;

    const headerRow = ws.getRow(r);
    headerRow.height = 20;
    ['Día', 'Día semana', 'Estado', 'Símbolo', 'Nota'].forEach((h, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.alignment = centerMid;
      cell.border = borderAll;
    });
    r++;

    const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const STATUS_LABELS: Record<string, { label: string; color: string; sym: string }> = {
      PRESENT: { label: 'Presente', color: GREEN, sym: '1' },
      ABSENT: { label: 'Ausente', color: RED, sym: '0' },
      LATE: { label: 'Atraso', color: ORANGE, sym: 'AT' },
      JUSTIFIED: { label: 'Justificado', color: YELLOW, sym: 'J' },
    };

    let p = 0,
      a = 0,
      l = 0,
      j = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const status = recordMap.get(d);

      ws.getCell(r, 1).value = d;
      ws.getCell(r, 1).alignment = centerMid;
      ws.getCell(r, 1).border = borderAll;
      ws.getCell(r, 2).value = DOW_NAMES[dow];
      ws.getCell(r, 2).alignment = centerMid;
      ws.getCell(r, 2).border = borderAll;

      if (isWeekend) {
        for (let c = 1; c <= 5; c++) {
          ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
        }
        ws.getCell(r, 3).value = '—';
        ws.getCell(r, 4).value = '—';
      } else if (status) {
        const cfg = STATUS_LABELS[status];
        ws.getCell(r, 3).value = cfg?.label ?? status;
        ws.getCell(r, 3).border = borderAll;
        ws.getCell(r, 4).value = cfg?.sym ?? '';
        ws.getCell(r, 4).alignment = centerMid;
        ws.getCell(r, 4).border = borderAll;
        ws.getCell(r, 4).font = { bold: true };
        if (cfg) {
          ws.getCell(r, 4).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: cfg.color },
          };
          if (cfg.sym !== 'J') {
            ws.getCell(r, 4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
          }
        }
        if (status === 'PRESENT') p++;
        else if (status === 'ABSENT') a++;
        else if (status === 'LATE') l++;
        else if (status === 'JUSTIFIED') j++;
      } else {
        ws.getCell(r, 3).value = 'Sin registro';
        ws.getCell(r, 3).font = { italic: true, color: { argb: 'FF999999' } };
        ws.getCell(r, 4).value = '—';
      }
      ws.getCell(r, 3).alignment = centerMid;
      ws.getCell(r, 3).border = borderAll;
      ws.getCell(r, 5).border = borderAll;
      r++;
    }

    r += 2;
    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value = 'RESUMEN';
    ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    ws.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell(r, 1).alignment = centerMid;
    r++;

    const nonSchoolDays = await this.calendar.getNonSchoolDays(student.course.school.id, from, to);
    const activeDays = this.countActiveSchoolDays(student, from, to, nonSchoolDays);
    const attendedDays = p + l;
    const rate = calculateReportAttendanceRate(attendedDays, activeDays);

    ws.getCell(r, 1).value = 'Presentes:';
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = p;
    ws.getCell(r, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    ws.getCell(r, 3).value = 'Ausentes:';
    ws.getCell(r, 3).font = { bold: true };
    ws.getCell(r, 4).value = a;
    ws.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
    r++;
    ws.getCell(r, 1).value = 'Atrasos:';
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = l;
    ws.getCell(r, 3).value = 'Justificados:';
    ws.getCell(r, 3).font = { bold: true };
    ws.getCell(r, 4).value = j;
    ws.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    r++;
    ws.getCell(r, 1).value = 'Días asistidos:';
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = attendedDays;
    ws.getCell(r, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    ws.getCell(r, 3).value = 'Total clases:';
    ws.getCell(r, 3).font = { bold: true };
    ws.getCell(r, 4).value = activeDays;
    ws.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    r++;
    ws.getCell(r, 1).value = '% Asistencia:';
    ws.getCell(r, 1).font = { bold: true };
    const pctCell = ws.getCell(r, 2);
    pctCell.value = rate;
    pctCell.numFmt = '0.0%';
    pctCell.font = { bold: true, size: 12 };
    pctCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: rate >= 0.9 ? 'FFE2EFDA' : rate >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
    };
    r += 2;

    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value =
      'Documento emitido conforme al Decreto 67/2018 del MINEDUC y Ley 19.799 (FES). ' +
      `El porcentaje se calcula como (Presentes + Atrasos) * 100 / Total clases: ${attendedDays} * 100 / ${activeDays}.`;
    ws.getCell(r, 1).font = { italic: true, size: 8, color: { argb: 'FF666666' } };
    ws.getCell(r, 1).alignment = { wrapText: true };
    ws.getRow(r).height = 30;

    const meta = wb.addWorksheet('RESUMEN');
    meta.getColumn(1).width = 20;
    meta.getColumn(2).width = 40;
    meta.addRow(['Establecimiento:', student.course.school.name]);
    meta.addRow(['Curso:', student.course.name]);
    meta.addRow([
      'Estudiante:',
      `${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName}`,
    ]);
    meta.addRow(['RUT:', student.rut]);
    meta.addRow(['N° Lista:', student.enrollmentNumber]);
    meta.addRow(['Período:', `${monthName} ${year}`]);
    meta.addRow(['Generado:', new Date().toLocaleDateString('es-CL')]);
    meta.getColumn(1).font = { bold: true };

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Student',
      entityId: studentId,
      meta: { year, month, format: 'student_monthly_xlsx' },
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async generateStudentSemesterExcel(
    studentId: string,
    year: number,
    semester: number,
    requestedById: string,
  ): Promise<Buffer> {
    const semLabel = semester === 1 ? '1er Semestre' : '2do Semestre';
    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        course: {
          include: {
            school: true,
            teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
          },
        },
      },
    });
    const semesterNumber = this.toSemesterNumber(semester);
    const period = await this.schoolConfig.getSemesterPeriod(
      student.course.schoolId,
      year,
      semesterNumber,
    );
    const ranges = period.ranges;
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      student.course.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);

    const allRecords = await this.prisma.attendanceRecord.findMany({
      where: { studentId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const byMonth = new Map<number, Array<{ date: Date; status: string }>>();
    for (const r of allRecords) {
      const m = r.date.getMonth() + 1;
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(r);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';

    const BLUE = 'FF1F4E79';
    const GREEN = 'FF00B050';
    const RED = 'FFC00000';
    const YELLOW = 'FFFFFF00';
    const ORANGE = 'FFED7D31';
    const GRAY = 'FFD9D9D9';
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    const centerMid = { horizontal: 'center' as const, vertical: 'middle' as const };

    const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const STATUS_MAP: Record<string, { label: string; color: string; sym: string }> = {
      PRESENT: { label: 'Presente', color: GREEN, sym: '1' },
      ABSENT: { label: 'Ausente', color: RED, sym: '0' },
      LATE: { label: 'Atraso', color: ORANGE, sym: 'AT' },
      JUSTIFIED: { label: 'Justificado', color: YELLOW, sym: 'J' },
    };

    for (const monthRange of monthRanges) {
      const { month, to: monthTo } = monthRange;
      const monthName = MONTH_NAMES_ES[month - 1] ?? '';
      const daysInMonth = monthTo.getDate();
      const records = (byMonth.get(month) ?? []).filter((record) =>
        this.schoolConfig.isDateInRanges(record.date, [monthRange]),
      );
      const recordMap = new Map<number, string>();
      for (const r of records) {
        recordMap.set(r.date.getDate(), r.status);
      }

      const ws = wb.addWorksheet(monthName.toUpperCase(), { views: [{ showGridLines: false }] });
      ws.getColumn(1).width = 8;
      ws.getColumn(2).width = 14;
      ws.getColumn(3).width = 16;
      ws.getColumn(4).width = 10;

      ws.mergeCells('A1:D1');
      const titleCell = ws.getCell('A1');
      titleCell.value = `${student.course.school.name} — ${monthName.toUpperCase()} ${year}`;
      titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      titleCell.alignment = centerMid;
      ws.getRow(1).height = 22;

      ws.mergeCells('A2:D2');
      ws.getCell('A2').value =
        `${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName} — RUT ${student.rut}`;
      ws.getCell('A2').alignment = centerMid;
      ws.getCell('A2').font = { bold: true, size: 10 };

      let r = 4;
      const headerRow = ws.getRow(r);
      headerRow.height = 20;
      ['Día', 'Día semana', 'Estado', 'Símbolo'].forEach((h, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
        cell.alignment = centerMid;
        cell.border = borderAll;
      });
      r++;

      let p = 0,
        a = 0,
        l = 0,
        j = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dow = date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const outsidePeriod = !this.schoolConfig.isDateInRanges(date, [monthRange]);
        const status = recordMap.get(d);

        ws.getCell(r, 1).value = d;
        ws.getCell(r, 1).alignment = centerMid;
        ws.getCell(r, 1).border = borderAll;
        ws.getCell(r, 2).value = DOW_NAMES[dow];
        ws.getCell(r, 2).alignment = centerMid;
        ws.getCell(r, 2).border = borderAll;

        if (outsidePeriod || isWeekend) {
          for (let c = 1; c <= 4; c++) {
            ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
          }
          ws.getCell(r, 3).value = '—';
          ws.getCell(r, 4).value = '—';
        } else if (status) {
          const cfg = STATUS_MAP[status];
          ws.getCell(r, 3).value = cfg?.label ?? status;
          ws.getCell(r, 3).alignment = centerMid;
          ws.getCell(r, 3).border = borderAll;
          ws.getCell(r, 4).value = cfg?.sym ?? '';
          ws.getCell(r, 4).alignment = centerMid;
          ws.getCell(r, 4).border = borderAll;
          ws.getCell(r, 4).font = { bold: true };
          if (cfg) {
            ws.getCell(r, 4).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: cfg.color },
            };
            if (cfg.sym !== 'J') {
              ws.getCell(r, 4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            }
          }
          if (status === 'PRESENT') p++;
          else if (status === 'ABSENT') a++;
          else if (status === 'LATE') l++;
          else if (status === 'JUSTIFIED') j++;
        } else {
          ws.getCell(r, 3).value = 'Sin registro';
          ws.getCell(r, 3).font = { italic: true, color: { argb: 'FF999999' } };
          ws.getCell(r, 4).value = '—';
        }
        ws.getCell(r, 3).border = borderAll;
        ws.getCell(r, 4).border = borderAll;
        r++;
      }

      r += 2;
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        [monthRange],
        nonSchoolDays,
      );
      const rate = activeDays > 0 ? (p + l) / activeDays : 0;
      ws.getCell(r, 1).value = 'P:';
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = p;
      ws.getCell(r, 3).value = 'A:';
      ws.getCell(r, 3).font = { bold: true };
      ws.getCell(r, 4).value = a;
      r++;
      ws.getCell(r, 1).value = 'AT:';
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = l;
      ws.getCell(r, 3).value = 'J:';
      ws.getCell(r, 3).font = { bold: true };
      ws.getCell(r, 4).value = j;
      r++;
      ws.getCell(r, 1).value = 'Asist.:';
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = p + l;
      ws.getCell(r, 3).value = 'Total clases:';
      ws.getCell(r, 3).font = { bold: true };
      ws.getCell(r, 4).value = activeDays;
      r++;
      ws.getCell(r, 1).value = '%:';
      ws.getCell(r, 1).font = { bold: true };
      const pctCell = ws.getCell(r, 2);
      pctCell.value = rate;
      pctCell.numFmt = '0.0%';
      pctCell.font = { bold: true };
    }

    const summary = wb.addWorksheet('RESUMEN SEMESTRAL', { views: [{ showGridLines: false }] });
    summary.getColumn(1).width = 16;
    summary.getColumn(2).width = 10;
    summary.getColumn(3).width = 10;
    summary.getColumn(4).width = 10;
    summary.getColumn(5).width = 10;
    summary.getColumn(6).width = 10;
    summary.getColumn(7).width = 12;
    summary.getColumn(8).width = 12;

    summary.mergeCells('A1:H1');
    summary.getCell('A1').value =
      `${student.course.school.name} — ${semLabel} ${year} — ${student.lastName}, ${student.firstName}`;
    summary.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    summary.getCell('A1').alignment = centerMid;
    summary.getRow(1).height = 22;

    ['Mes', 'P', 'A', 'AT', 'J', 'Asist.', 'Total clases', '% Asist.'].forEach((h, i) => {
      const c = summary.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.alignment = centerMid;
      c.border = borderAll;
    });

    let totalP = 0,
      totalA = 0,
      totalL = 0,
      totalJ = 0;
    for (const [i, monthRange] of monthRanges.entries()) {
      const month = monthRange.month;
      const monthRecords = (byMonth.get(month) ?? []).filter((record) =>
        this.schoolConfig.isDateInRanges(record.date, [monthRange]),
      );
      let mp = 0,
        ma = 0,
        ml = 0,
        mj = 0;
      for (const r of monthRecords) {
        if (r.status === 'PRESENT') mp++;
        else if (r.status === 'ABSENT') ma++;
        else if (r.status === 'LATE') ml++;
        else if (r.status === 'JUSTIFIED') mj++;
      }
      totalP += mp;
      totalA += ma;
      totalL += ml;
      totalJ += mj;

      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        [monthRange],
        nonSchoolDays,
      );
      const rate = activeDays > 0 ? (mp + ml) / activeDays : 0;

      const r = i + 3;
      summary.getCell(r, 1).value = MONTH_NAMES_ES[month - 1] ?? '';
      summary.getCell(r, 1).border = borderAll;
      summary.getCell(r, 2).value = mp;
      summary.getCell(r, 2).alignment = centerMid;
      summary.getCell(r, 2).border = borderAll;
      summary.getCell(r, 3).value = ma;
      summary.getCell(r, 3).alignment = centerMid;
      summary.getCell(r, 3).border = borderAll;
      summary.getCell(r, 4).value = ml;
      summary.getCell(r, 4).alignment = centerMid;
      summary.getCell(r, 4).border = borderAll;
      summary.getCell(r, 5).value = mj;
      summary.getCell(r, 5).alignment = centerMid;
      summary.getCell(r, 5).border = borderAll;
      summary.getCell(r, 6).value = mp + ml;
      summary.getCell(r, 6).alignment = centerMid;
      summary.getCell(r, 6).border = borderAll;
      summary.getCell(r, 7).value = activeDays;
      summary.getCell(r, 7).alignment = centerMid;
      summary.getCell(r, 7).border = borderAll;
      const pctCell = summary.getCell(r, 8);
      pctCell.value = rate;
      pctCell.numFmt = '0.0%';
      pctCell.alignment = centerMid;
      pctCell.border = borderAll;
      pctCell.font = { bold: true };
      pctCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rate >= 0.9 ? 'FFE2EFDA' : rate >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };
    }

    const semesterActiveDays = this.schoolConfig.countActiveSchoolDaysInRanges(
      student,
      ranges,
      nonSchoolDays,
    );
    const semesterAttendedDays = totalP + totalL;
    const semesterRate = calculateReportAttendanceRate(semesterAttendedDays, semesterActiveDays);
    const totalRow = monthRanges.length + 3;
    for (let c = 1; c <= 8; c++) {
      const cell = summary.getCell(totalRow, c);
      cell.border = borderAll;
      cell.alignment = c === 1 ? { vertical: 'middle' } : centerMid;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    }
    summary.getCell(totalRow, 1).value = 'TOTAL';
    summary.getCell(totalRow, 2).value = totalP;
    summary.getCell(totalRow, 3).value = totalA;
    summary.getCell(totalRow, 4).value = totalL;
    summary.getCell(totalRow, 5).value = totalJ;
    summary.getCell(totalRow, 6).value = semesterAttendedDays;
    summary.getCell(totalRow, 7).value = semesterActiveDays;
    const semesterPctCell = summary.getCell(totalRow, 8);
    semesterPctCell.value = semesterRate;
    semesterPctCell.numFmt = '0.0%';
    semesterPctCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: semesterRate >= 0.9 ? 'FFE2EFDA' : semesterRate >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4',
      },
    };
    const formulaRow = totalRow + 2;
    summary.mergeCells(formulaRow, 1, formulaRow, 8);
    summary.getCell(formulaRow, 1).value =
      `% = (Presentes + Atrasos) * 100 / Total clases. Cálculo total: ${semesterAttendedDays} * 100 / ${semesterActiveDays}.`;
    summary.getCell(formulaRow, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Student',
      entityId: studentId,
      meta: { year, semester, format: 'student_semester_xlsx' },
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async generateStudentAnnualExcel(
    studentId: string,
    year: number,
    requestedById: string,
  ): Promise<Buffer> {
    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        course: {
          include: {
            school: true,
            teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
          },
        },
      },
    });
    const period = await this.schoolConfig.getAnnualPeriod(student.course.schoolId, year);
    const ranges = period.ranges;
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      student.course.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);

    const allRecords = await this.prisma.attendanceRecord.findMany({
      where: { studentId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const byMonth = new Map<number, Array<{ date: Date; status: string }>>();
    for (const r of allRecords) {
      const m = r.date.getMonth() + 1;
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(r);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia CSSP';

    const BLUE = 'FF1F4E79';
    const GREEN = 'FF00B050';
    const RED = 'FFC00000';
    const YELLOW = 'FFFFFF00';
    const ORANGE = 'FFED7D31';
    const GRAY = 'FFD9D9D9';
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    const centerMid = { horizontal: 'center' as const, vertical: 'middle' as const };

    const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const STATUS_MAP: Record<string, { label: string; color: string; sym: string }> = {
      PRESENT: { label: 'Presente', color: GREEN, sym: '1' },
      ABSENT: { label: 'Ausente', color: RED, sym: '0' },
      LATE: { label: 'Atraso', color: ORANGE, sym: 'AT' },
      JUSTIFIED: { label: 'Justificado', color: YELLOW, sym: 'J' },
    };

    for (const monthRange of monthRanges) {
      const { month, to: monthTo } = monthRange;
      const monthName = MONTH_NAMES_ES[month - 1] ?? '';
      const daysInMonth = monthTo.getDate();
      const records = (byMonth.get(month) ?? []).filter((record) =>
        this.schoolConfig.isDateInRanges(record.date, [monthRange]),
      );
      const recordMap = new Map<number, string>();
      for (const r of records) {
        recordMap.set(r.date.getDate(), r.status);
      }

      const ws = wb.addWorksheet(monthName.toUpperCase(), { views: [{ showGridLines: false }] });
      ws.getColumn(1).width = 8;
      ws.getColumn(2).width = 14;
      ws.getColumn(3).width = 16;
      ws.getColumn(4).width = 10;

      ws.mergeCells('A1:D1');
      const titleCell = ws.getCell('A1');
      titleCell.value = `${student.course.school.name} — ${monthName.toUpperCase()} ${year}`;
      titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      titleCell.alignment = centerMid;
      ws.getRow(1).height = 22;

      ws.mergeCells('A2:D2');
      ws.getCell('A2').value =
        `${student.lastName}${student.secondLastName ? ' ' + student.secondLastName : ''}, ${student.firstName} — RUT ${student.rut}`;
      ws.getCell('A2').alignment = centerMid;
      ws.getCell('A2').font = { bold: true, size: 10 };

      let r = 4;
      const headerRow = ws.getRow(r);
      headerRow.height = 20;
      ['Día', 'Día semana', 'Estado', 'Símbolo'].forEach((h, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
        cell.alignment = centerMid;
        cell.border = borderAll;
      });
      r++;

      let p = 0,
        a = 0,
        l = 0,
        j = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dow = date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const outsidePeriod = !this.schoolConfig.isDateInRanges(date, [monthRange]);
        const status = recordMap.get(d);

        ws.getCell(r, 1).value = d;
        ws.getCell(r, 1).alignment = centerMid;
        ws.getCell(r, 1).border = borderAll;
        ws.getCell(r, 2).value = DOW_NAMES[dow];
        ws.getCell(r, 2).alignment = centerMid;
        ws.getCell(r, 2).border = borderAll;

        if (outsidePeriod || isWeekend) {
          for (let c = 1; c <= 4; c++) {
            ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
          }
          ws.getCell(r, 3).value = '—';
          ws.getCell(r, 4).value = '—';
        } else if (status) {
          const cfg = STATUS_MAP[status];
          ws.getCell(r, 3).value = cfg?.label ?? status;
          ws.getCell(r, 3).alignment = centerMid;
          ws.getCell(r, 3).border = borderAll;
          ws.getCell(r, 4).value = cfg?.sym ?? '';
          ws.getCell(r, 4).alignment = centerMid;
          ws.getCell(r, 4).border = borderAll;
          ws.getCell(r, 4).font = { bold: true };
          if (cfg) {
            ws.getCell(r, 4).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: cfg.color },
            };
            if (cfg.sym !== 'J') {
              ws.getCell(r, 4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            }
          }
          if (status === 'PRESENT') p++;
          else if (status === 'ABSENT') a++;
          else if (status === 'LATE') l++;
          else if (status === 'JUSTIFIED') j++;
        } else {
          ws.getCell(r, 3).value = 'Sin registro';
          ws.getCell(r, 3).font = { italic: true, color: { argb: 'FF999999' } };
          ws.getCell(r, 4).value = '—';
        }
        ws.getCell(r, 3).border = borderAll;
        ws.getCell(r, 4).border = borderAll;
        r++;
      }

      r += 2;
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        [monthRange],
        nonSchoolDays,
      );
      const rate = activeDays > 0 ? (p + l) / activeDays : 0;
      ws.getCell(r, 1).value = 'P:';
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = p;
      ws.getCell(r, 3).value = 'A:';
      ws.getCell(r, 3).font = { bold: true };
      ws.getCell(r, 4).value = a;
      r++;
      ws.getCell(r, 1).value = 'AT:';
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = l;
      ws.getCell(r, 3).value = 'J:';
      ws.getCell(r, 3).font = { bold: true };
      ws.getCell(r, 4).value = j;
      r++;
      ws.getCell(r, 1).value = 'Asist.:';
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = p + l;
      ws.getCell(r, 3).value = 'Total clases:';
      ws.getCell(r, 3).font = { bold: true };
      ws.getCell(r, 4).value = activeDays;
      r++;
      ws.getCell(r, 1).value = '%:';
      ws.getCell(r, 1).font = { bold: true };
      const pctCell = ws.getCell(r, 2);
      pctCell.value = rate;
      pctCell.numFmt = '0.0%';
      pctCell.font = { bold: true };
    }

    const summary = wb.addWorksheet('RESUMEN ANUAL', { views: [{ showGridLines: false }] });
    summary.getColumn(1).width = 16;
    summary.getColumn(2).width = 10;
    summary.getColumn(3).width = 10;
    summary.getColumn(4).width = 10;
    summary.getColumn(5).width = 10;
    summary.getColumn(6).width = 10;
    summary.getColumn(7).width = 12;
    summary.getColumn(8).width = 12;

    summary.mergeCells('A1:H1');
    summary.getCell('A1').value =
      `${student.course.school.name} — ${year} — ${student.lastName}, ${student.firstName}`;
    summary.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    summary.getCell('A1').alignment = centerMid;
    summary.getRow(1).height = 22;

    ['Mes', 'P', 'A', 'AT', 'J', 'Asist.', 'Total clases', '% Asist.'].forEach((h, i) => {
      const c = summary.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.alignment = centerMid;
      c.border = borderAll;
    });

    let totalP = 0,
      totalA = 0,
      totalL = 0,
      totalJ = 0;
    for (const [i, monthRange] of monthRanges.entries()) {
      const month = monthRange.month;
      const monthRecords = (byMonth.get(month) ?? []).filter((record) =>
        this.schoolConfig.isDateInRanges(record.date, [monthRange]),
      );
      let mp = 0,
        ma = 0,
        ml = 0,
        mj = 0;
      for (const r of monthRecords) {
        if (r.status === 'PRESENT') mp++;
        else if (r.status === 'ABSENT') ma++;
        else if (r.status === 'LATE') ml++;
        else if (r.status === 'JUSTIFIED') mj++;
      }
      totalP += mp;
      totalA += ma;
      totalL += ml;
      totalJ += mj;

      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        [monthRange],
        nonSchoolDays,
      );
      const rate = activeDays > 0 ? (mp + ml) / activeDays : 0;

      const r = i + 3;
      summary.getCell(r, 1).value = MONTH_NAMES_ES[month - 1] ?? '';
      summary.getCell(r, 1).border = borderAll;
      summary.getCell(r, 2).value = mp;
      summary.getCell(r, 2).alignment = centerMid;
      summary.getCell(r, 2).border = borderAll;
      summary.getCell(r, 3).value = ma;
      summary.getCell(r, 3).alignment = centerMid;
      summary.getCell(r, 3).border = borderAll;
      summary.getCell(r, 4).value = ml;
      summary.getCell(r, 4).alignment = centerMid;
      summary.getCell(r, 4).border = borderAll;
      summary.getCell(r, 5).value = mj;
      summary.getCell(r, 5).alignment = centerMid;
      summary.getCell(r, 5).border = borderAll;
      summary.getCell(r, 6).value = mp + ml;
      summary.getCell(r, 6).alignment = centerMid;
      summary.getCell(r, 6).border = borderAll;
      summary.getCell(r, 7).value = activeDays;
      summary.getCell(r, 7).alignment = centerMid;
      summary.getCell(r, 7).border = borderAll;
      const pctCell = summary.getCell(r, 8);
      pctCell.value = rate;
      pctCell.numFmt = '0.0%';
      pctCell.alignment = centerMid;
      pctCell.border = borderAll;
      pctCell.font = { bold: true };
      pctCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rate >= 0.9 ? 'FFE2EFDA' : rate >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };
    }

    const totalRow = monthRanges.length + 3;
    summary.getCell(totalRow, 1).value = 'TOTAL';
    summary.getCell(totalRow, 1).font = { bold: true };
    summary.getCell(totalRow, 1).border = borderAll;
    summary.getCell(totalRow, 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDCE6F1' },
    };
    summary.getCell(totalRow, 2).value = totalP;
    summary.getCell(totalRow, 2).alignment = centerMid;
    summary.getCell(totalRow, 2).border = borderAll;
    summary.getCell(totalRow, 2).font = { bold: true };
    summary.getCell(totalRow, 3).value = totalA;
    summary.getCell(totalRow, 3).alignment = centerMid;
    summary.getCell(totalRow, 3).border = borderAll;
    summary.getCell(totalRow, 3).font = { bold: true };
    summary.getCell(totalRow, 4).value = totalL;
    summary.getCell(totalRow, 4).alignment = centerMid;
    summary.getCell(totalRow, 4).border = borderAll;
    summary.getCell(totalRow, 4).font = { bold: true };
    summary.getCell(totalRow, 5).value = totalJ;
    summary.getCell(totalRow, 5).alignment = centerMid;
    summary.getCell(totalRow, 5).border = borderAll;
    summary.getCell(totalRow, 5).font = { bold: true };

    const annualActiveDays = this.schoolConfig.countActiveSchoolDaysInRanges(
      student,
      ranges,
      nonSchoolDays,
    );
    const annualAttendedDays = totalP + totalL;
    summary.getCell(totalRow, 6).value = annualAttendedDays;
    summary.getCell(totalRow, 6).alignment = centerMid;
    summary.getCell(totalRow, 6).border = borderAll;
    summary.getCell(totalRow, 6).font = { bold: true };
    summary.getCell(totalRow, 7).value = annualActiveDays;
    summary.getCell(totalRow, 7).alignment = centerMid;
    summary.getCell(totalRow, 7).border = borderAll;
    summary.getCell(totalRow, 7).font = { bold: true };
    const annualRate = calculateReportAttendanceRate(annualAttendedDays, annualActiveDays);
    const annualPct = summary.getCell(totalRow, 8);
    annualPct.value = annualRate;
    annualPct.numFmt = '0.0%';
    annualPct.alignment = centerMid;
    annualPct.border = borderAll;
    annualPct.font = { bold: true, size: 12 };
    annualPct.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: annualRate >= 0.9 ? 'FFE2EFDA' : annualRate >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4',
      },
    };

    const formulaRow = totalRow + 2;
    summary.mergeCells(formulaRow, 1, formulaRow, 8);
    summary.getCell(formulaRow, 1).value =
      `% = (Presentes + Atrasos) * 100 / Total clases. Cálculo total: ${annualAttendedDays} * 100 / ${annualActiveDays}.`;
    summary.getCell(formulaRow, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Student',
      entityId: studentId,
      meta: { year, format: 'student_annual_xlsx' },
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
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
          enrollmentNumber: number;
          enrolledAt: Date;
          withdrawnAt: Date | null;
        }>;
      };
      year: number;
      month: number;
      from?: Date;
      to: Date;
      records: Map<string, Map<string, string>>;
      nonSchoolDays?: Set<string>;
    },
  ) {
    const { course, year, month, to, records } = ctx;
    const from = ctx.from ?? new Date(year, month - 1, 1);
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
    for (let c = 36; c <= 40; c++) ws.getColumn(c).width = c === 38 ? 10 : 8; // AJ..AN summary

    const centerMid = {
      horizontal: 'center' as const,
      vertical: 'middle' as const,
      wrapText: true,
    };
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };

    // ---- Row 1: title ----
    ws.mergeCells('B1:AN1');
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
      const outsidePeriod = date < this.startOfDay(from) || date > this.startOfDay(to);

      const dayCell = ws.getCell(11, c);
      dayCell.value = d;
      dayCell.alignment = centerMid;
      dayCell.font = { bold: true, size: 9 };
      dayCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isWeekend || outsidePeriod ? GRAY : LIGHT_BLUE },
      };
      dayCell.border = borderAll;

      const dowCell = ws.getCell(12, c);
      dowCell.value = DOW_LABELS[dow];
      dowCell.alignment = centerMid;
      dowCell.font = { bold: true, size: 9 };
      dowCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isWeekend || outsidePeriod ? GRAY : LIGHT_BLUE },
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
      { col: 'AL', label: 'TOTAL CLASES', color: LIGHT_BLUE, textColor: 'FF000000' },
      { col: 'AM', label: '% ASIST.', color: ORANGE },
      { col: 'AN', label: 'JUSTIF.', color: YELLOW, textColor: 'FF000000' },
    ];
    for (const s of summary) {
      ws.mergeCells(`${s.col}11:${s.col}13`);
      const cell = ws.getCell(`${s.col}11`);
      cell.value = s.label;
      cell.alignment = { ...centerMid, textRotation: 90 };
      cell.font = { bold: true, size: 10, color: { argb: s.textColor ?? 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.color } };
      cell.border = borderAll;
    }

    // ---- Student rows (14..) ----
    let r = 14;
    // P2: We need the period boundaries to compute correct denominators
    const periodFrom = from;
    const periodTo = to;

    for (const student of course.students) {
      const row = ws.getRow(r);
      row.height = 18;

      // P2: Use real enrollmentNumber (MINEDUC: immutable list number)
      const numCell = ws.getCell(r, 2);
      numCell.value = student.enrollmentNumber;
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
        const outsidePeriod =
          date < this.startOfDay(periodFrom) || date > this.startOfDay(periodTo);
        const cell = ws.getCell(r, c);
        cell.border = borderAll;
        cell.alignment = centerMid;
        cell.font = { size: 9, bold: true };

        if (outsidePeriod || isWeekend) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
          continue;
        }

        const key = this.schoolConfig.formatDate(date);
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
        } else if (sym === '-') {
          // Withdrawn — grey cell
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
          cell.value = '-';
          cell.font = { size: 8, color: { argb: 'FF666666' } };
        }
      }

      // P2 FIX: denominator = active school days for this student, not total records
      const activeDays = this.countActiveSchoolDays(
        student,
        periodFrom,
        periodTo,
        ctx.nonSchoolDays,
      );
      const pct = activeDays > 0 ? present / activeDays : 0;

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

      const t = ws.getCell(r, 38);
      t.value = activeDays;
      t.alignment = centerMid;
      t.border = borderAll;
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE } };

      const p = ws.getCell(r, 39);
      p.value = pct;
      p.numFmt = '0.0%';
      p.alignment = centerMid;
      p.border = borderAll;
      p.font = { bold: true };
      p.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: pct >= 0.85 ? 'FFE2EFDA' : pct >= 0.7 ? 'FFFFF2CC' : 'FFFCE4E4' },
      };

      const j = ws.getCell(r, 40);
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

  private toSemesterNumber(value: number): 1 | 2 {
    return value === 2 ? 2 : 1;
  }

  private periodLabel(ranges: DateRange[]): string {
    return ranges
      .map((range) => `${this.shortDateLabel(range.from)} – ${this.shortDateLabel(range.to)}`)
      .join(' · ');
  }

  private shortDateLabel(date: Date): string {
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  /**
   * P2 (Decreto 67): Count active school days for a student.
   * The denominator for % attendance must exclude days before enrolledAt
   * and days after withdrawnAt (i.e., only days the student was enrolled).
   * Also excludes weekends and non-school days (holidays/suspended).
   */
  private countActiveSchoolDays(
    student: { enrolledAt: Date; withdrawnAt: Date | null },
    from: Date,
    to: Date,
    nonSchoolDays: Set<string> = new Set(),
  ): number {
    const start = this.startOfDay(student.enrolledAt > from ? student.enrolledAt : from);
    const withdrawnEnd =
      student.withdrawnAt && student.withdrawnAt <= to
        ? this.previousCalendarDay(student.withdrawnAt)
        : to;
    const end = this.startOfDay(withdrawnEnd);
    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const dow = cursor.getDay();
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      if (dow !== 0 && dow !== 6 && !nonSchoolDays.has(key)) days++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  /**
   * P3 (MINEDUC Control de Subvenciones): Build a dedicated sheet
   * with the official movement summary required by MINEDUC.
   */
  private buildMovimientosSheet(
    wb: ExcelJS.Workbook,
    ctx: {
      course: {
        name: string;
        school: { name: string };
        students: Array<{
          id: string;
          firstName: string;
          lastName: string;
          rut: string;
          enrollmentNumber: number;
          enrolledAt: Date;
          withdrawnAt: Date | null;
        }>;
      };
      year: number;
      month: number;
      from: Date;
      to: Date;
      events: Array<{
        status: string;
        effectiveDate: Date;
        reason: string | null;
        withdrawalReason?: WithdrawalReason | string | null;
        student: { firstName: string; lastName: string; rut: string; enrollmentNumber: number };
      }>;
      nonSchoolDays?: Set<string>;
    },
  ) {
    const { course, year, month, from, to, events, nonSchoolDays } = ctx;
    const BLUE = 'FF1F4E79';
    const LIGHT_BLUE = 'FFDCE6F1';
    const GREEN = 'FFE2EFDA';
    const RED = 'FFFCE4E4';
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    const centerMid = { horizontal: 'center' as const, vertical: 'middle' as const };
    const monthName = MONTH_NAMES_ES[month - 1] ?? '';

    const ws = wb.addWorksheet(`SUBV ${monthName.substring(0, 3).toUpperCase()}`, {
      views: [{ showGridLines: false }],
    });
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 8;
    ws.getColumn(3).width = 38;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 40;

    // Title
    ws.mergeCells('A1:E1');
    const title = ws.getCell('A1');
    title.value = `CONTROL DE SUBVENCIONES — ${monthName.toUpperCase()} ${year}`;
    title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    title.alignment = centerMid;
    ws.getRow(1).height = 26;

    ws.mergeCells('A2:E2');
    ws.getCell('A2').value = `${course.school.name}  —  Curso: ${course.name}`;
    ws.getCell('A2').font = { bold: true, size: 11 };
    ws.getCell('A2').alignment = centerMid;
    ws.getRow(2).height = 18;

    let r = 4;

    // --- Section 1: enrollment summary ---
    const incorporated = events.filter((e) =>
      ['ACTIVE', 'RE_ENROLLED', 'TRANSFERRED_IN'].includes(e.status),
    );
    const withdrawn = events.filter((e) => ['WITHDRAWN', 'TRANSFERRED_OUT'].includes(e.status));

    const matriculaInicio = course.students.filter(
      (s) =>
        this.startOfDay(s.enrolledAt) <= from &&
        (!s.withdrawnAt || this.startOfDay(s.withdrawnAt) >= from),
    ).length;
    const matriculaFin = course.students.filter(
      (s) =>
        this.startOfDay(s.enrolledAt) <= to &&
        (!s.withdrawnAt || this.startOfDay(s.withdrawnAt) > to),
    ).length;

    const sectionHeader = (label: string) => {
      ws.mergeCells(r, 1, r, 5);
      const cell = ws.getCell(r, 1);
      cell.value = label;
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      ws.getRow(r).height = 20;
      r++;
    };

    const dataRow = (label: string, value: string | number, bgArgb?: string) => {
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 1).font = { bold: true };
      ws.mergeCells(r, 2, r, 2);
      ws.getCell(r, 2).value = value;
      ws.getCell(r, 2).alignment = centerMid;
      ws.getCell(r, 2).border = borderAll;
      if (bgArgb)
        ws.getCell(r, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      r++;
    };

    sectionHeader('1. RESUMEN DE MATRÍCULA');
    dataRow('Matrícula inicio del mes', matriculaInicio);
    dataRow('Alumnos incorporados en el mes', incorporated.length, GREEN);
    dataRow('Alumnos retirados en el mes', withdrawn.length, RED);
    dataRow('Matrícula fin del mes', matriculaFin);
    r++;

    // --- Section 2: incorporated list ---
    sectionHeader('2. ALUMNOS INCORPORADOS EN EL MES');
    if (incorporated.length === 0) {
      ws.mergeCells(r, 1, r, 5);
      ws.getCell(r, 1).value = 'Sin incorporaciones en el período';
      ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF666666' } };
      r++;
    } else {
      // Header row
      ['N° Lista', 'Nombres y Apellidos', 'RUT', 'Fecha Incorporación', 'Motivo'].forEach(
        (h, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = h;
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
          cell.border = borderAll;
          cell.alignment = centerMid;
        },
      );
      r++;
      for (const e of incorporated) {
        ws.getCell(r, 1).value = e.student.enrollmentNumber;
        ws.getCell(r, 2).value = `${e.student.lastName}, ${e.student.firstName}`;
        ws.getCell(r, 3).value = e.student.rut;
        ws.getCell(r, 4).value = e.effectiveDate.toLocaleDateString('es-CL');
        ws.getCell(r, 5).value = e.reason ?? '—';
        for (let c = 1; c <= 5; c++) {
          ws.getCell(r, c).border = borderAll;
          ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
        }
        r++;
      }
    }
    r++;

    // --- Section 3: withdrawn list ---
    sectionHeader('3. ALUMNOS RETIRADOS EN EL MES');
    if (withdrawn.length === 0) {
      ws.mergeCells(r, 1, r, 5);
      ws.getCell(r, 1).value = 'Sin retiros en el período';
      ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF666666' } };
      r++;
    } else {
      ['N° Lista', 'Nombres y Apellidos', 'RUT', 'Fecha Retiro', 'Motivo'].forEach((h, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        cell.border = borderAll;
        cell.alignment = centerMid;
      });
      r++;
      for (const e of withdrawn) {
        ws.getCell(r, 1).value = e.student.enrollmentNumber;
        ws.getCell(r, 2).value = `${e.student.lastName}, ${e.student.firstName}`;
        ws.getCell(r, 3).value = e.student.rut;
        ws.getCell(r, 4).value = e.effectiveDate.toLocaleDateString('es-CL');
        ws.getCell(r, 5).value = formatWithdrawalReason(e.withdrawalReason, e.reason);
        for (let c = 1; c <= 5; c++) {
          ws.getCell(r, c).border = borderAll;
          ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
        }
        r++;
      }
    }
    r++;

    // --- Section 4: asistencia media (P2 denominator fix) ---
    sectionHeader('4. ASISTENCIA MEDIA DEL MES (Decreto 67/2018)');

    // Count working days in the month (Mon-Fri, excluding holidays/suspended)
    const daysInMonth = to.getDate();
    let schoolDaysMonth = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(to.getFullYear(), to.getMonth(), d);
      const dow = date.getDay();
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (dow !== 0 && dow !== 6 && !nonSchoolDays?.has(key)) schoolDaysMonth++;
    }

    let totalAlumnoDias = 0;
    for (const student of course.students) {
      const activeDays = this.countActiveSchoolDays(student, from, to, nonSchoolDays);
      totalAlumnoDias += activeDays;
    }

    dataRow('Días hábiles del mes (L-V)', schoolDaysMonth, LIGHT_BLUE);
    dataRow('Total alumno×día posibles', totalAlumnoDias, LIGHT_BLUE);
    dataRow('Alumnos activos al cierre', matriculaFin);
    r++;

    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value =
      'Nota: El porcentaje de asistencia individual en la hoja MINEDUC se calcula sobre los días ' +
      'en que el alumno estuvo matriculado (Decreto 67/2018, Art. 12). ' +
      'Los alumnos incorporados y retirados cuentan solo sus días activos.';
    ws.getCell(r, 1).font = { italic: true, size: 9, color: { argb: 'FF444444' } };
    ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 40;
    r++;

    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value =
      `Documento generado automáticamente — ${course.school.name} · ` +
      new Date().toLocaleDateString('es-CL');
    ws.getCell(r, 1).font = { italic: true, size: 8, color: { argb: 'FF999999' } };
  }

  // activeDuringPeriodWhere is defined above (line 1741)
  // Duplicate removed.

  /** Renders one month's MINEDUC grid page(s) into an existing PDFDocument. */
  private renderMonthGridPage(
    doc: PDFKit.PDFDocument,
    course: {
      school: { name: string };
      name: string;
      teachers: Array<{ user: { firstName: string; lastName: string } | null }>;
      students: Array<{
        id: string;
        enrollmentNumber: number;
        firstName: string;
        lastName: string;
        secondLastName: string | null;
        enrolledAt: Date;
        withdrawnAt: Date | null;
      }>;
    },
    year: number,
    month: number,
    recordMap: Map<string, Map<number, string>>,
    options?: { isFirstMonth?: boolean; from?: Date; to?: Date; nonSchoolDays?: Set<string> },
  ): void {
    const daysInMonth = new Date(year, month, 0).getDate();
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

    if (!options?.isFirstMonth) doc.addPage();

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

      const activeDays = this.countActiveSchoolDays(
        s,
        options?.from ?? new Date(year, month - 1, 1),
        options?.to ?? new Date(year, month, 0, 23, 59, 59, 999),
        options?.nonSchoolDays ?? new Set(),
      );
      const rate = calculateReportAttendanceRate(p + l, activeDays);
      if (activeDays > 0) {
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
      doc.text(activeDays > 0 ? `${(rate * 100).toFixed(1)}%` : '—', x, y + 4, {
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
    doc.text(
      'Leyenda: 1 = Presente  ·  0 = Ausente  ·  AT = Atraso  ·  J = Justificado  ·  % = (Presentes + Atrasos) * 100 / Total clases',
      NAV_X,
      y,
    );
  }

  /** MINEDUC-style semester PDF: one month grid page per month in the semester period. */
  async generateSemesterGridPdf(
    courseId: string,
    year: number,
    semester: number,
    requestedById: string,
  ): Promise<Buffer> {
    const courseHead = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const semesterNumber = this.toSemesterNumber(semester);
    const period = await this.schoolConfig.getSemesterPeriod(
      courseHead.schoolId,
      year,
      semesterNumber,
    );
    const ranges = period.ranges;
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);

    const globalFrom = ranges[0]!.from;
    const globalTo = ranges[ranges.length - 1]!.to;

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.schoolConfig.activeDuringRangesWhere(ranges),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: globalFrom, lte: globalTo } },
      select: { studentId: true, date: true, status: true },
    });
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      globalFrom,
      globalTo,
    );

    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    for (const [idx, mr] of monthRanges.entries()) {
      const monthFrom = mr.from;
      const monthTo = mr.to;
      const recordMap = new Map<string, Map<number, string>>();
      for (const r of records) {
        const rDate = r.date;
        if (rDate < monthFrom || rDate > monthTo) continue;
        const day = rDate.getUTCDate();
        if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
        recordMap.get(r.studentId)!.set(day, SYMBOL[r.status] ?? '-');
      }
      this.renderMonthGridPage(doc, course, monthFrom.getFullYear(), mr.month, recordMap, {
        isFirstMonth: idx === 0,
        from: monthFrom,
        to: monthTo,
        nonSchoolDays,
      });
    }

    doc.end();
    await done;

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, semester, format: 'semester_grid_pdf' },
    });

    return Buffer.concat(chunks);
  }

  /** MINEDUC-style annual PDF: one month grid page per month in the annual period. */
  async generateAnnualGridPdf(
    courseId: string,
    year: number,
    requestedById: string,
  ): Promise<Buffer> {
    const courseHead = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const period = await this.schoolConfig.getAnnualPeriod(courseHead.schoolId, year);
    const ranges = period.ranges;
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);

    const globalFrom = ranges[0]!.from;
    const globalTo = ranges[ranges.length - 1]!.to;

    const course = await this.prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        school: true,
        teachers: { include: { user: true }, where: { isHead: true }, take: 1 },
        students: {
          where: this.schoolConfig.activeDuringRangesWhere(ranges),
          orderBy: { enrollmentNumber: 'asc' },
        },
      },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: globalFrom, lte: globalTo } },
      select: { studentId: true, date: true, status: true },
    });
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      globalFrom,
      globalTo,
    );

    const SYMBOL: Record<string, string> = {
      PRESENT: '1',
      ABSENT: '0',
      LATE: 'AT',
      JUSTIFIED: 'J',
      WITHDRAWN: '-',
    };

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    for (const [idx, mr] of monthRanges.entries()) {
      const monthFrom = mr.from;
      const monthTo = mr.to;
      const recordMap = new Map<string, Map<number, string>>();
      for (const r of records) {
        const rDate = r.date;
        if (rDate < monthFrom || rDate > monthTo) continue;
        const day = rDate.getUTCDate();
        if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
        recordMap.get(r.studentId)!.set(day, SYMBOL[r.status] ?? '-');
      }
      this.renderMonthGridPage(doc, course, monthFrom.getFullYear(), mr.month, recordMap, {
        isFirstMonth: idx === 0,
        from: monthFrom,
        to: monthTo,
        nonSchoolDays,
      });
    }

    doc.end();
    await done;

    await this.audit.log({
      userId: requestedById,
      action: 'EXPORT',
      entity: 'Course',
      entityId: courseId,
      meta: { year, format: 'annual_grid_pdf' },
    });

    return Buffer.concat(chunks);
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

  private previousCalendarDay(date: Date): Date {
    const d = this.startOfDay(date);
    d.setDate(d.getDate() - 1);
    return d;
  }
}
