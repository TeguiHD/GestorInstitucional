import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CalendarDayType } from '@prisma/client';

import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CalendarService {
  private readonly log = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async listBySchool(schoolId: string, year?: number) {
    const where: { schoolId: string; date?: { gte: Date; lte: Date } } = { schoolId };
    if (year) {
      where.date = { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31) };
    }
    return this.prisma.schoolCalendarDay.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  async create(dto: {
    schoolId: string;
    date: string;
    type: CalendarDayType;
    description: string;
    notify?: boolean;
  }) {
    const created = await this.prisma.schoolCalendarDay.upsert({
      where: { schoolId_date: { schoolId: dto.schoolId, date: new Date(dto.date) } },
      update: { type: dto.type, description: dto.description },
      create: {
        schoolId: dto.schoolId,
        date: new Date(dto.date),
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
      { md: '06-20', desc: 'Día Nacional de los Pueblos Indígenas' },
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
      const date = new Date(`${year}-${h.md}T00:00:00`);
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
    const days = await this.prisma.schoolCalendarDay.findMany({
      where: {
        schoolId,
        date: { gte: from, lte: to },
        type: { in: ['HOLIDAY', 'SUSPENDED'] },
      },
      select: { date: true },
    });
    return new Set(days.map((d) => d.date.toISOString().split('T')[0]!));
  }
}
