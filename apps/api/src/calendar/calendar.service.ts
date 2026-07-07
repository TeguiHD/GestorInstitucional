import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CalendarDayType } from '@prisma/client';

import { expandDateOnlyRange, parseDateOnlyUtc } from '../common/date-only.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolConfigService } from '../school-config/school-config.service.js';

type CalendarDayRow = {
  id: string;
  schoolId: string;
  date: Date;
  type: CalendarDayType;
  description: string;
};
type CalendarDayResponse = Omit<CalendarDayRow, 'date'> & { date: string };
type NonSchoolDayDetail = { type: string; description: string };

@Injectable()
export class CalendarService {
  private readonly log = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly schoolConfig: SchoolConfigService,
  ) {}

  async listBySchool(schoolId: string, year?: number) {
    const where: { schoolId: string; date?: { gte: Date; lte: Date } } = { schoolId };
    if (year) {
      const range = expandDateOnlyRange(
        parseDateOnlyUtc(`${year}-01-01`),
        parseDateOnlyUtc(`${year}-12-31`),
      );
      where.date = { gte: range.from, lte: range.to };
    }
    const days = await this.prisma.schoolCalendarDay.findMany({
      where,
      orderBy: { date: 'asc' },
    });
    const byDate = new Map<string, CalendarDayResponse>();
    for (const day of days) {
      const date = this.calendarDateKey(day);
      if (year && !date.startsWith(`${year}-`)) continue;
      byDate.set(date, { ...day, date });
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async create(dto: {
    schoolId: string;
    date: string;
    type: CalendarDayType;
    description: string;
    notify?: boolean;
  }) {
    const date = parseDateOnlyUtc(dto.date);
    const created = await this.prisma.schoolCalendarDay.upsert({
      where: { schoolId_date: { schoolId: dto.schoolId, date } },
      update: { type: dto.type, description: dto.description },
      create: {
        schoolId: dto.schoolId,
        date,
        type: dto.type,
        description: dto.description,
      },
    });

    if (dto.notify) {
      void this.broadcastDay(created.id).catch((e) =>
        this.log.warn(`broadcastDay failed: ${(e as Error).message}`),
      );
    }

    return created;
  }

  async broadcastDay(dayId: string) {
    const day = await this.prisma.schoolCalendarDay.findUnique({
      where: { id: dayId },
      include: { school: { select: { id: true, name: true } } },
    });
    if (!day) throw new NotFoundException('Día no encontrado');

    const guardians = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        schoolRoles: { some: { schoolId: day.schoolId, role: 'APODERADO' } },
        guardianships: { some: { student: { schoolId: day.schoolId, active: true } } },
      },
      select: { email: true, firstName: true, lastName: true },
    });

    const recipients = guardians.map((g) => ({
      email: g.email,
      name: `${g.firstName} ${g.lastName}`,
    }));
    if (recipients.length === 0) return { enqueued: 0, deduped: 0 };

    return this.mail.sendSuspensionBroadcast({
      calendarDayId: day.id,
      schoolId: day.schoolId,
      schoolName: day.school.name,
      date: day.date,
      description: day.description,
      type: day.type as 'HOLIDAY' | 'SUSPENDED' | 'EVENT',
      recipients,
    });
  }

  /** schoolId del día, para validar acceso por colegio en el controlador. */
  async getDaySchoolId(id: string): Promise<string> {
    const day = await this.prisma.schoolCalendarDay.findUnique({
      where: { id },
      select: { schoolId: true },
    });
    if (!day) throw new NotFoundException('Día no encontrado');
    return day.schoolId;
  }

  async remove(id: string) {
    const day = await this.prisma.schoolCalendarDay.findUnique({ where: { id } });
    if (!day) throw new NotFoundException('Día no encontrado');
    await this.prisma.schoolCalendarDay.delete({ where: { id } });
    return { ok: true };
  }

  /** Seed feriados oficiales Chile (fixed dates — movable ones like Viernes Santo must be added manually). */
  async seedChileHolidays(schoolId: string, year: number) {
    const fixed = [
      { md: '01-01', desc: 'Año Nuevo' },
      { md: '05-01', desc: 'Día del Trabajador' },
      { md: '05-21', desc: 'Día de las Glorias Navales' },
      { md: '06-21', desc: 'Día Nacional de los Pueblos Indígenas' },
      { md: '06-29', desc: 'San Pedro y San Pablo' },
      { md: '07-16', desc: 'Virgen del Carmen' },
      { md: '08-15', desc: 'Asunción de la Virgen' },
      { md: '09-18', desc: 'Independencia Nacional' },
      { md: '09-19', desc: 'Glorias del Ejército' },
      { md: '10-12', desc: 'Encuentro de Dos Mundos' },
      { md: '10-31', desc: 'Día de las Iglesias Evangélicas' },
      { md: '11-01', desc: 'Todos los Santos' },
      { md: '12-08', desc: 'Inmaculada Concepción' },
      { md: '12-25', desc: 'Navidad' },
    ];

    const ops = fixed.map((h) => {
      const date = parseDateOnlyUtc(`${year}-${h.md}`);
      return this.prisma.schoolCalendarDay.upsert({
        where: { schoolId_date: { schoolId, date } },
        update: {},
        create: { schoolId, date, type: 'HOLIDAY' as CalendarDayType, description: h.desc },
      });
    });
    await this.prisma.$transaction(ops);
    return { seeded: fixed.length, year };
  }

  /**
   * Returns set of ISO dates (YYYY-MM-DD) that are NOT school days in the range:
   * days marked HOLIDAY or SUSPENDED in the calendar, plus every day outside the
   * configured academic year (before 1st semester, between semesters, after 2nd).
   */
  async getNonSchoolDays(schoolId: string, from: Date, to: Date): Promise<Set<string>> {
    const range = expandDateOnlyRange(from, to);
    const days = await this.prisma.schoolCalendarDay.findMany({
      where: {
        schoolId,
        date: { gte: range.from, lte: range.to },
        type: { in: ['HOLIDAY', 'SUSPENDED'] },
      },
      select: { id: true, schoolId: true, date: true, type: true, description: true },
    });
    const fromKey = this.schoolConfig.formatDate(from);
    const toKey = this.schoolConfig.formatDate(to);
    const outOfPeriod = await this.getOutOfPeriodDays(schoolId, from, to);
    return new Set([
      ...days
        .map((d) => this.calendarDateKey(d))
        .filter((dateKey) => dateKey >= fromKey && dateKey <= toKey),
      ...outOfPeriod.keys(),
    ]);
  }

  async getNonSchoolDayDetails(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, NonSchoolDayDetail>> {
    const range = expandDateOnlyRange(from, to);
    const fromKey = this.schoolConfig.formatDate(from);
    const toKey = this.schoolConfig.formatDate(to);
    const days = await this.prisma.schoolCalendarDay.findMany({
      where: {
        schoolId,
        date: { gte: range.from, lte: range.to },
        type: { in: ['HOLIDAY', 'SUSPENDED'] },
      },
      select: { id: true, schoolId: true, date: true, type: true, description: true },
    });

    const result: Record<string, NonSchoolDayDetail> = {};
    for (const [key, detail] of await this.getOutOfPeriodDays(schoolId, from, to)) {
      result[key] = detail;
    }
    // Los días marcados explícitamente en el calendario ganan sobre la etiqueta sintética.
    for (const day of days) {
      const key = this.calendarDateKey(day);
      if (key < fromKey || key > toKey) continue;
      result[key] = { type: day.type, description: day.description };
    }
    return result;
  }

  /**
   * Días de [from, to] que caen fuera del período lectivo del año escolar
   * (config guardada o default por año, vía SchoolConfigService). Son entradas
   * sintéticas — no se persisten en school_calendar_days — de modo que un
   * cambio en la configuración de semestres se refleja de inmediato.
   */
  private async getOutOfPeriodDays(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Map<string, NonSchoolDayDetail>> {
    const result = new Map<string, NonSchoolDayDetail>();
    const fromKey = this.schoolConfig.formatDate(from);
    const toKey = this.schoolConfig.formatDate(to);
    if (fromKey > toKey) return result;

    const startYear = Number(fromKey.slice(0, 4));
    const endYear = Number(toKey.slice(0, 4));

    for (let year = startYear; year <= endYear; year++) {
      const { ranges } = await this.schoolConfig.getAnnualPeriod(schoolId, year);
      const firstStartKey = ranges[0] ? this.schoolConfig.formatDate(ranges[0].from) : null;
      const lastEndKey = ranges[ranges.length - 1]
        ? this.schoolConfig.formatDate(ranges[ranges.length - 1]!.to)
        : null;

      const yearFromKey = fromKey > `${year}-01-01` ? fromKey : `${year}-01-01`;
      const yearToKey = toKey < `${year}-12-31` ? toKey : `${year}-12-31`;
      if (yearFromKey > yearToKey) continue;

      const cursor = parseDateOnlyUtc(yearFromKey);
      const end = parseDateOnlyUtc(yearToKey);
      while (cursor <= end) {
        const key = this.schoolConfig.formatDate(cursor);
        if (!this.schoolConfig.isDateInRanges(cursor, ranges)) {
          const isSummer =
            (firstStartKey !== null && key < firstStartKey) ||
            (lastEndKey !== null && key > lastEndKey);
          result.set(key, {
            type: 'VACATION',
            description: isSummer ? 'Vacaciones de verano' : 'Vacaciones de invierno',
          });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return result;
  }

  private calendarDateKey(day: { date: Date; description: string }): string {
    const key = this.schoolConfig.formatDate(day.date);
    const normalizedDescription = day.description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (normalizedDescription.includes('pueblos indigenas')) {
      return `${key.slice(0, 4)}-06-21`;
    }

    return key;
  }
}
