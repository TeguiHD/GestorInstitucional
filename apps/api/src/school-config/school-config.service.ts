import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AcademicYearSource = 'saved' | 'default';
export type SemesterNumber = 1 | 2;

export type DateRange = {
  from: Date;
  to: Date;
};

export type MonthRange = DateRange & {
  month: number;
};

export type AcademicYearPeriod = {
  label: string;
  ranges: DateRange[];
  source: AcademicYearSource;
};

type UpdateAcademicYearConfigInput = {
  firstSemesterStart: string;
  firstSemesterEnd: string;
  secondSemesterStart: string;
  secondSemesterEnd: string;
};

type StudentPeriod = {
  enrolledAt: Date;
  withdrawnAt: Date | null;
};

@Injectable()
export class SchoolConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getAcademicYearConfig(schoolId: string, year: number) {
    await this.assertSchoolExists(schoolId);
    const saved = await this.prisma.schoolAcademicYearConfig.findUnique({
      where: { schoolId_year: { schoolId, year } },
    });

    if (!saved) {
      return this.toResponse(schoolId, year, this.defaultRanges(year), 'default');
    }

    return this.toResponse(
      schoolId,
      year,
      {
        firstSemester: { from: saved.firstSemesterStart, to: saved.firstSemesterEnd },
        secondSemester: { from: saved.secondSemesterStart, to: saved.secondSemesterEnd },
      },
      'saved',
    );
  }

  async upsertAcademicYearConfig(
    schoolId: string,
    year: number,
    input: UpdateAcademicYearConfigInput,
    requestedById: string,
  ) {
    await this.assertSchoolExists(schoolId);
    const ranges = this.validateInput(year, input);
    await this.assertAttendanceFitsConfiguredRanges(schoolId, year, [
      ranges.firstSemester,
      ranges.secondSemester,
    ]);

    const saved = await this.prisma.schoolAcademicYearConfig.upsert({
      where: { schoolId_year: { schoolId, year } },
      update: {
        firstSemesterStart: ranges.firstSemester.from,
        firstSemesterEnd: ranges.firstSemester.to,
        secondSemesterStart: ranges.secondSemester.from,
        secondSemesterEnd: ranges.secondSemester.to,
      },
      create: {
        schoolId,
        year,
        firstSemesterStart: ranges.firstSemester.from,
        firstSemesterEnd: ranges.firstSemester.to,
        secondSemesterStart: ranges.secondSemester.from,
        secondSemesterEnd: ranges.secondSemester.to,
      },
    });

    await this.audit.log({
      userId: requestedById,
      action: 'UPDATE',
      entity: 'SchoolAcademicYearConfig',
      entityId: saved.id,
      meta: {
        schoolId,
        year,
        firstSemesterStart: this.formatDate(ranges.firstSemester.from),
        firstSemesterEnd: this.formatDate(ranges.firstSemester.to),
        secondSemesterStart: this.formatDate(ranges.secondSemester.from),
        secondSemesterEnd: this.formatDate(ranges.secondSemester.to),
      },
    });

    return this.toResponse(
      schoolId,
      year,
      {
        firstSemester: { from: saved.firstSemesterStart, to: saved.firstSemesterEnd },
        secondSemester: { from: saved.secondSemesterStart, to: saved.secondSemesterEnd },
      },
      'saved',
    );
  }

  async getSemesterPeriod(
    schoolId: string,
    year: number,
    semester: SemesterNumber,
  ): Promise<AcademicYearPeriod> {
    const config = await this.getAcademicYearConfig(schoolId, year);
    const range =
      semester === 1
        ? {
            from: this.parseDate(config.firstSemester.startDate),
            to: this.endOfDay(this.parseDate(config.firstSemester.endDate)),
          }
        : {
            from: this.parseDate(config.secondSemester.startDate),
            to: this.endOfDay(this.parseDate(config.secondSemester.endDate)),
          };

    return {
      label: `${semester === 1 ? '1er' : '2do'} Semestre ${year}`,
      ranges: [range],
      source: config.source,
    };
  }

  async getAnnualPeriod(schoolId: string, year: number): Promise<AcademicYearPeriod> {
    const config = await this.getAcademicYearConfig(schoolId, year);
    return {
      label: `Año escolar ${year}`,
      ranges: [
        {
          from: this.parseDate(config.firstSemester.startDate),
          to: this.endOfDay(this.parseDate(config.firstSemester.endDate)),
        },
        {
          from: this.parseDate(config.secondSemester.startDate),
          to: this.endOfDay(this.parseDate(config.secondSemester.endDate)),
        },
      ],
      source: config.source,
    };
  }

  monthsForRanges(ranges: DateRange[]): MonthRange[] {
    const months = new Map<string, MonthRange>();
    for (const range of ranges) {
      const cursor = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
      const last = new Date(range.to.getFullYear(), range.to.getMonth(), 1);

      while (cursor <= last) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth() + 1;
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
        const from = this.maxDate(range.from, monthStart);
        const to = this.minDate(range.to, monthEnd);
        months.set(`${year}-${month}`, { month, from, to });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    return Array.from(months.values()).sort((a, b) => a.from.getTime() - b.from.getTime());
  }

  attendanceWhereForRanges(ranges: DateRange[]): Prisma.AttendanceRecordWhereInput {
    return { OR: ranges.map((range) => ({ date: { gte: range.from, lte: range.to } })) };
  }

  enrollmentWhereForRanges(ranges: DateRange[]): Prisma.EnrollmentEventWhereInput {
    return { OR: ranges.map((range) => ({ effectiveDate: { gte: range.from, lte: range.to } })) };
  }

  activeDuringRangesWhere(ranges: DateRange[]): Prisma.StudentWhereInput {
    return {
      firstName: { not: '[Eliminado]' },
      OR: ranges.map((range) => ({
        enrolledAt: { lte: range.to },
        OR: [{ withdrawnAt: null }, { withdrawnAt: { gte: range.from } }],
      })),
    };
  }

  isDateInRanges(date: Date, ranges: DateRange[]): boolean {
    const day = this.formatDate(date);
    return ranges.some(
      (range) => day >= this.formatDate(range.from) && day <= this.formatDate(range.to),
    );
  }

  countActiveSchoolDaysInRanges(
    student: StudentPeriod,
    ranges: DateRange[],
    nonSchoolDays: Set<string> = new Set(),
  ): number {
    return ranges.reduce(
      (total, range) => total + this.countActiveSchoolDays(student, range, nonSchoolDays),
      0,
    );
  }

  formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private defaultRanges(year: number) {
    return {
      firstSemester: {
        from: this.makeDate(year, 3, 4),
        to: this.makeDate(year, 6, 18, true),
      },
      secondSemester: {
        from: this.makeDate(year, 7, 1),
        to: this.makeDate(year, 12, 31, true),
      },
    };
  }

  private toResponse(
    schoolId: string,
    year: number,
    ranges: { firstSemester: DateRange; secondSemester: DateRange },
    source: AcademicYearSource,
  ) {
    return {
      schoolId,
      year,
      source,
      firstSemester: {
        startDate: this.formatDate(ranges.firstSemester.from),
        endDate: this.formatDate(ranges.firstSemester.to),
      },
      secondSemester: {
        startDate: this.formatDate(ranges.secondSemester.from),
        endDate: this.formatDate(ranges.secondSemester.to),
      },
      annual: {
        ranges: [
          {
            startDate: this.formatDate(ranges.firstSemester.from),
            endDate: this.formatDate(ranges.firstSemester.to),
          },
          {
            startDate: this.formatDate(ranges.secondSemester.from),
            endDate: this.formatDate(ranges.secondSemester.to),
          },
        ],
      },
    };
  }

  private validateInput(year: number, input: UpdateAcademicYearConfigInput) {
    const firstSemester = {
      from: this.parseDateForYear(input.firstSemesterStart, year, 'firstSemesterStart'),
      to: this.endOfDay(this.parseDateForYear(input.firstSemesterEnd, year, 'firstSemesterEnd')),
    };
    const secondSemester = {
      from: this.parseDateForYear(input.secondSemesterStart, year, 'secondSemesterStart'),
      to: this.endOfDay(this.parseDateForYear(input.secondSemesterEnd, year, 'secondSemesterEnd')),
    };

    if (firstSemester.from > firstSemester.to) {
      throw new BadRequestException('El inicio del primer semestre debe ser anterior al término');
    }
    if (firstSemester.to >= secondSemester.from) {
      throw new BadRequestException(
        'El término del primer semestre debe ser anterior al inicio del segundo semestre',
      );
    }
    if (secondSemester.from > secondSemester.to) {
      throw new BadRequestException('El inicio del segundo semestre debe ser anterior al término');
    }

    return { firstSemester, secondSemester };
  }

  private async assertAttendanceFitsConfiguredRanges(
    schoolId: string,
    year: number,
    ranges: DateRange[],
  ): Promise<void> {
    const yearStart = this.makeDate(year, 1, 1);
    const yearEnd = this.makeDate(year, 12, 31, true);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        course: { schoolId },
        date: { gte: yearStart, lte: yearEnd },
      },
      select: { date: true },
      distinct: ['date'],
      orderBy: { date: 'asc' },
    });

    const conflictingDates = records
      .map((record) => record.date)
      .filter((date) => !this.isDateInRanges(date, ranges))
      .map((date) => this.formatDate(date));

    if (conflictingDates.length > 0) {
      throw new ConflictException({
        message:
          'No se puede guardar la configuración porque existen asistencias fuera de los semestres configurados',
        conflictingDates: conflictingDates.slice(0, 10),
        totalConflicts: conflictingDates.length,
      });
    }
  }

  private async assertSchoolExists(schoolId: string): Promise<void> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true },
    });
    if (!school) throw new NotFoundException('Colegio no encontrado');
  }

  private parseDateForYear(value: string, year: number, field: string): Date {
    const date = this.parseDate(value, field);
    if (date.getFullYear() !== year) {
      throw new BadRequestException(`${field} debe pertenecer al año ${year}`);
    }
    return date;
  }

  private parseDate(value: string, field = 'date'): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new BadRequestException(`${field} debe usar formato YYYY-MM-DD`);

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = this.makeDate(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
      throw new BadRequestException(`${field} no es una fecha válida`);
    }
    return date;
  }

  private makeDate(year: number, month: number, day: number, endOfDay = false): Date {
    return endOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day);
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private endOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  private minDate(a: Date, b: Date): Date {
    return a <= b ? a : b;
  }

  private maxDate(a: Date, b: Date): Date {
    return a >= b ? a : b;
  }

  private previousCalendarDay(date: Date): Date {
    const d = this.startOfDay(date);
    d.setDate(d.getDate() - 1);
    return d;
  }

  private countActiveSchoolDays(
    student: StudentPeriod,
    range: DateRange,
    nonSchoolDays: Set<string> = new Set(),
  ): number {
    const start = this.startOfDay(
      student.enrolledAt > range.from ? student.enrolledAt : range.from,
    );
    const withdrawnEnd =
      student.withdrawnAt && student.withdrawnAt <= range.to
        ? this.previousCalendarDay(student.withdrawnAt)
        : range.to;
    const end = this.startOfDay(withdrawnEnd);
    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6 && !nonSchoolDays.has(this.formatDate(cursor))) days++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }
}
