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

  /** Returns set of ISO dates (YYYY-MM-DD) marked HOLIDAY or SUSPENDED in given range. */
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
    return new Set(
      days
        .map((d) => this.calendarDateKey(d))
        .filter((dateKey) => dateKey >= fromKey && dateKey <= toKey),
    );
  }

  async getNonSchoolDayDetails(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, { type: string; description: string }>> {
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

    const result: Record<string, { type: string; description: string }> = {};
    for (const day of days) {
      const key = this.calendarDateKey(day);
      if (key < fromKey || key > toKey) continue;
      result[key] = { type: day.type, description: day.description };
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
