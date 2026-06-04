import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SystemRole, type AttendanceStatus } from '@prisma/client';

import { CalendarService } from '../calendar/calendar.service.js';
import { MailService } from '../mail/mail.service.js';
import { WhatsAppService } from '../mail/whatsapp.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { parseDateOnlyUtc } from '../common/date-only.js';
import { SchoolConfigService } from '../school-config/school-config.service.js';
import type { RecordAttendanceDto } from './dto/record-attendance.dto.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

@Injectable()
export class AttendanceService {
  private readonly log = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsAppService,
    private readonly schoolConfig: SchoolConfigService,
  ) {}

  /** Bulk upsert daily attendance for a course. Idempotent — safe to call multiple times. */
  async recordBulk(dto: RecordAttendanceDto, recordedById: string): Promise<{ upserted: number }> {
    const date = parseDateOnlyUtc(dto.date);
    const activeStudentIds = await this.assertEntriesBelongToCourse(dto, date);
    await this.assertDailyAttendanceComplete(dto, date, activeStudentIds);

    const upserts = dto.entries.map((entry) =>
      this.prisma.attendanceRecord.upsert({
        where: { studentId_date: { studentId: entry.studentId, date } },
        update: {
          status: entry.status as AttendanceStatus,
          note: entry.note ?? null,
          lateMinutes: entry.lateMinutes ?? null,
          recordedById,
          updatedAt: new Date(),
        },
        create: {
          studentId: entry.studentId,
          courseId: dto.courseId,
          date,
          status: entry.status as AttendanceStatus,
          note: entry.note ?? null,
          lateMinutes: entry.lateMinutes ?? null,
          recordedById,
        },
      }),
    );

    await this.prisma.$transaction(upserts);

    await this.audit.log({
      userId: recordedById,
      action: 'UPDATE',
      entity: 'AttendanceRecord',
      entityId: dto.courseId,
      meta: { date: dto.date, count: dto.entries.length },
    });

    void this.notifyGuardiansAbsence(dto, date).catch((e) =>
      this.log.warn(`notifyGuardiansAbsence failed: ${e instanceof Error ? e.message : String(e)}`),
    );

    return { upserted: dto.entries.length };
  }

  private async assertEntriesBelongToCourse(
    dto: RecordAttendanceDto,
    date: Date,
  ): Promise<Set<string>> {
    const seen = new Set<string>();
    for (const entry of dto.entries) {
      if (seen.has(entry.studentId)) {
        throw new BadRequestException('No se permiten alumnos duplicados en la asistencia');
      }
      seen.add(entry.studentId);
    }

    const students = await this.prisma.student.findMany({
      where: {
        courseId: dto.courseId,
        enrolledAt: { lte: date },
        firstName: { not: '[Eliminado]' },
        OR: [{ withdrawnAt: null }, { withdrawnAt: { gt: date } }],
      },
      select: { id: true },
    });
    const allowedStudentIds = new Set(students.map((student) => student.id));
    const invalidEntry = dto.entries.find((entry) => !allowedStudentIds.has(entry.studentId));

    if (invalidEntry) {
      throw new BadRequestException(
        'La asistencia contiene alumnos fuera del curso o fuera de su período activo',
      );
    }

    return allowedStudentIds;
  }

  private async assertDailyAttendanceComplete(
    dto: RecordAttendanceDto,
    date: Date,
    activeStudentIds: Set<string>,
  ) {
    const existingRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        courseId: dto.courseId,
        date,
        studentId: { in: Array.from(activeStudentIds) },
      },
      select: { studentId: true },
    });

    const coveredStudentIds = new Set(existingRecords.map((record) => record.studentId));
    for (const entry of dto.entries) {
      coveredStudentIds.add(entry.studentId);
    }

    const missingCount = Array.from(activeStudentIds).filter(
      (studentId) => !coveredStudentIds.has(studentId),
    ).length;
    if (missingCount > 0) {
      throw new BadRequestException(
        `La asistencia del día debe incluir a todos los alumnos activos. Faltan ${missingCount} alumno${
          missingCount !== 1 ? 's' : ''
        }.`,
      );
    }
  }

  private async notifyGuardiansAbsence(dto: RecordAttendanceDto, date: Date) {
    const lateThresholdMin = Number(process.env.LATE_NOTIFY_THRESHOLD_MIN ?? 15);
    const toNotify = dto.entries.filter(
      (e) =>
        e.status === 'ABSENT' || (e.status === 'LATE' && (e.lateMinutes ?? 0) >= lateThresholdMin),
    );
    if (toNotify.length === 0) return;

    // Don't notify for days marked HOLIDAY/SUSPENDED
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: { schoolId: true, name: true },
    });
    if (!course) return;
    const nonSchool = await this.calendar.getNonSchoolDays(course.schoolId, date, date);
    const dateKey = date.toISOString().split('T')[0]!;
    if (nonSchool.has(dateKey)) return;

    const studentIds = toNotify.map((e) => e.studentId);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { date, studentId: { in: studentIds } },
      select: {
        id: true,
        studentId: true,
        status: true,
        lateMinutes: true,
        student: {
          select: {
            firstName: true,
            lastName: true,
            guardianships: {
              select: {
                isPrimary: true,
                notifyAbsences: true,
                notifyLate: true,
                notifyUntil: true,
                guardian: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    status: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const now = new Date();
    for (const rec of records) {
      if (rec.status !== 'ABSENT' && rec.status !== 'LATE') continue;
      const wantsNotif = (g: {
        notifyAbsences: boolean;
        notifyLate: boolean;
        notifyUntil: Date | null;
      }) =>
        (rec.status === 'ABSENT' ? g.notifyAbsences : g.notifyLate) &&
        (g.notifyUntil === null || g.notifyUntil > now);
      const isActiveGuardian = (g: { guardian: { status: string; deletedAt: Date | null } }) =>
        g.guardian.status === 'ACTIVE' && !g.guardian.deletedAt;
      const primary = rec.student.guardianships.find(
        (g) => g.isPrimary && isActiveGuardian(g) && wantsNotif(g),
      );
      const guardians = primary
        ? [primary]
        : rec.student.guardianships.filter((g) => isActiveGuardian(g) && wantsNotif(g));
      for (const g of guardians) {
        await this.mail.sendAbsenceDaily({
          guardianId: g.guardian.id,
          guardianEmail: g.guardian.email,
          guardianName: `${g.guardian.firstName} ${g.guardian.lastName}`,
          studentName: `${rec.student.firstName} ${rec.student.lastName}`,
          courseName: course.name,
          recordId: rec.id,
          date,
          status: rec.status,
          lateMinutes: rec.lateMinutes,
          schoolId: course.schoolId,
        });
        if (g.guardian.phone) {
          const school = await this.prisma.school.findUnique({
            where: { id: course.schoolId },
            select: { name: true },
          });
          void this.whatsapp
            .sendAbsenceAlert({
              guardianPhone: g.guardian.phone,
              studentName: `${rec.student.firstName} ${rec.student.lastName}`,
              courseName: course.name,
              date,
              schoolName: school?.name ?? 'Colegio',
              status: rec.status as 'ABSENT' | 'LATE',
            })
            .catch((e: Error) => this.log.warn(`WhatsApp error: ${e.message}`));
        }
      }
    }
  }

  async getByCourseDate(courseId: string, date: string) {
    return this.prisma.attendanceRecord.findMany({
      where: { courseId, date: new Date(date) },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            secondLastName: true,
            enrollmentNumber: true,
            rut: true,
          },
        },
      },
      orderBy: { student: { enrollmentNumber: 'asc' } },
    });
  }

  async getByStudent(studentId: string, from?: string, to?: string) {
    return this.prisma.attendanceRecord.findMany({
      where: {
        studentId,
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  /** Course summary: group by date, calc rates. */
  async getCourseMonthSummary(courseId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0); // last day

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: from, lte: to } },
      select: { date: true, status: true, studentId: true },
    });

    // Group by date
    const byDate = new Map<
      string,
      { present: number; absent: number; late: number; justified: number; total: number }
    >();
    for (const r of records) {
      const key = r.date.toISOString().split('T')[0]!;
      const entry = byDate.get(key) ?? { present: 0, absent: 0, late: 0, justified: 0, total: 0 };
      entry.total++;
      if (r.status === 'PRESENT') entry.present++;
      else if (r.status === 'ABSENT') entry.absent++;
      else if (r.status === 'LATE') entry.late++;
      else if (r.status === 'JUSTIFIED') entry.justified++;
      byDate.set(key, entry);
    }

    return Array.from(byDate.entries()).map(([date, counts]) => ({
      date,
      ...counts,
      attendanceRate:
        counts.total > 0 ? (counts.present + counts.late + counts.justified) / counts.total : 0,
    }));
  }

  /** School-level stats per course for a given period. */
  async getSchoolStats(schoolId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const [courses, nonSchool] = await Promise.all([
      this.prisma.course.findMany({
        where: { schoolId, active: true },
        select: { id: true, code: true, name: true },
      }),
      this.calendar.getNonSchoolDays(schoolId, fromDate, toDate),
    ]);

    const courseIds = courses.map((course) => course.id);
    const nonSchoolDates = Array.from(nonSchool).map((date) => new Date(date));

    const grouped =
      courseIds.length === 0
        ? []
        : await this.prisma.attendanceRecord.groupBy({
            by: ['courseId', 'status'],
            where: {
              courseId: { in: courseIds },
              date: {
                gte: fromDate,
                lte: toDate,
                notIn: nonSchoolDates,
              },
            },
            _count: { _all: true },
          });

    const byCourse = new Map<string, { total: number; present: number }>();
    for (const row of grouped) {
      const cur = byCourse.get(row.courseId) ?? { total: 0, present: 0 };
      cur.total += row._count._all;
      if (row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'JUSTIFIED')
        cur.present += row._count._all;
      byCourse.set(row.courseId, cur);
    }

    return courses
      .map((c) => {
        const agg = byCourse.get(c.id) ?? { total: 0, present: 0 };
        return { ...c, ...agg, attendanceRate: agg.total > 0 ? agg.present / agg.total : 0 };
      })
      .sort((a, b) => b.attendanceRate - a.attendanceRate);
  }

  async getCourseDailyTrend(courseId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: fromDate, lte: toDate } },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const byDate = new Map<string, { total: number; present: number }>();
    for (const r of records) {
      const d = r.date.toISOString().split('T')[0]!;
      const cur = byDate.get(d) ?? { total: 0, present: 0 };
      cur.total += 1;
      if (r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'JUSTIFIED')
        cur.present += 1;
      byDate.set(d, cur);
    }

    return Array.from(byDate.entries()).map(([date, agg]) => ({
      date,
      total: agg.total,
      present: agg.present,
      rate: agg.total > 0 ? agg.present / agg.total : 0,
    }));
  }

  async getCourseMatrix(courseId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const [course, records] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          students: {
            where: {
              enrolledAt: { lte: to },
              firstName: { not: '[Eliminado]' },
              OR: [{ withdrawnAt: null }, { withdrawnAt: { gte: from } }],
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              secondLastName: true,
              enrollmentNumber: true,
              enrolledAt: true,
              withdrawnAt: true,
            },
            orderBy: [{ enrollmentNumber: 'asc' }],
          },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { courseId, date: { gte: from, lte: to } },
        select: { studentId: true, date: true, status: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    if (!course) throw new NotFoundException('Curso no encontrado');

    // Build ALL weekday dates for the month (Mon-Fri)
    const allDates: string[] = [];
    const lastDay = new Date(year, month, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(year, month - 1, d);
      const dow = dt.getDay();
      if (dow !== 0 && dow !== 6) {
        allDates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }

    // Fetch non-school days (holidays, suspended) for the month
    const nonSchoolDaysSet = await this.calendar.getNonSchoolDays(
      course.schoolId,
      from,
      new Date(year, month, 0),
    );

    // Also fetch full calendar day records for descriptions
    const calendarDays = await this.prisma.schoolCalendarDay.findMany({
      where: {
        schoolId: course.schoolId,
        date: { gte: from, lte: new Date(year, month, 0) },
        type: { in: ['HOLIDAY', 'SUSPENDED'] },
      },
      select: { date: true, type: true, description: true },
    });

    const nonSchoolDays: Record<string, { type: string; description: string }> = {};
    for (const cd of calendarDays) {
      const key = cd.date.toISOString().split('T')[0]!;
      nonSchoolDays[key] = { type: cd.type, description: cd.description };
    }

    // School days = weekdays minus non-school days
    const schoolDays = allDates.filter((d) => !nonSchoolDaysSet.has(d));

    // Use allDates (all weekdays) as column reference, but keep backward compat via `dates`
    const dates = allDates;

    const matrix: Record<string, Record<string, string>> = {};
    records.forEach((r) => {
      const date = r.date.toISOString().split('T')[0]!;
      if (!matrix[r.studentId]) matrix[r.studentId] = {};
      matrix[r.studentId]![date] = r.status;
    });

    const studentStats = course.students.map((s) => {
      for (const dateKey of dates) {
        const date = this.startOfDay(new Date(`${dateKey}T00:00:00.000Z`));
        if (s.withdrawnAt && this.startOfDay(s.withdrawnAt) <= date) {
          if (!matrix[s.id]) matrix[s.id] = {};
          matrix[s.id]![dateKey] = 'WITHDRAWN';
        }
      }
      const studentRecords = Object.values(matrix[s.id] ?? {}).filter((st) => st !== 'WITHDRAWN');
      const total = studentRecords.length;
      const present = studentRecords.filter(
        (st) => st === 'PRESENT' || st === 'LATE' || st === 'JUSTIFIED',
      ).length;
      const absent = studentRecords.filter((st) => st === 'ABSENT').length;
      const justified = studentRecords.filter((st) => st === 'JUSTIFIED').length;
      return { ...s, total, present, absent, justified, rate: total > 0 ? present / total : null };
    });

    const todayKey = new Date().toISOString().split('T')[0]!;

    return { students: studentStats, dates, matrix, nonSchoolDays, schoolDays, today: todayKey };
  }

  async getCourseSummary(courseId: string, from: string, to: string) {
    const fromDate = new Date(from + 'T00:00:00.000Z');
    const toDate = new Date(to + 'T23:59:59.999Z');

    const [course, records] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          students: {
            where: {
              enrolledAt: { lte: toDate },
              firstName: { not: '[Eliminado]' },
              OR: [{ withdrawnAt: null }, { withdrawnAt: { gte: fromDate } }],
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              secondLastName: true,
              enrollmentNumber: true,
              enrolledAt: true,
              withdrawnAt: true,
            },
            orderBy: [{ enrollmentNumber: 'asc' }],
          },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { courseId, date: { gte: fromDate, lte: toDate } },
        select: { studentId: true, date: true, status: true },
      }),
    ]);

    if (!course) throw new NotFoundException('Curso no encontrado');

    const statsByStudent = new Map<
      string,
      { total: number; present: number; absent: number; late: number; justified: number }
    >();
    for (const s of course.students) {
      statsByStudent.set(s.id, { total: 0, present: 0, absent: 0, late: 0, justified: 0 });
    }

    for (const r of records) {
      const stats = statsByStudent.get(r.studentId);
      if (!stats) continue;
      if (r.status === 'WITHDRAWN') continue;
      stats.total++;
      if (r.status === 'PRESENT') stats.present++;
      else if (r.status === 'ABSENT') stats.absent++;
      else if (r.status === 'LATE') {
        stats.late++;
        stats.present++;
      } else if (r.status === 'JUSTIFIED') {
        stats.justified++;
        stats.present++;
      }
    }

    const students = course.students.map((s) => {
      const stats = statsByStudent.get(s.id)!;
      const rate = stats.total > 0 ? stats.present / stats.total : null;
      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        secondLastName: s.secondLastName,
        enrollmentNumber: s.enrollmentNumber,
        total: stats.total,
        present: stats.present,
        absent: stats.absent,
        late: stats.late,
        justified: stats.justified,
        rate,
      };
    });

    return {
      students,
      period: { from, to },
    };
  }

  async getCourseAcademicSummary(
    courseId: string,
    year: number,
    period: 'semester' | 'annual',
    semester?: 1 | 2,
  ) {
    const courseHead = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { schoolId: true },
    });
    if (!courseHead) throw new NotFoundException('Curso no encontrado');

    const resolved =
      period === 'semester'
        ? await this.schoolConfig.getSemesterPeriod(courseHead.schoolId, year, semester ?? 1)
        : await this.schoolConfig.getAnnualPeriod(courseHead.schoolId, year);
    const ranges = resolved.ranges;

    const [course, records] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          students: {
            where: this.schoolConfig.activeDuringRangesWhere(ranges),
            select: {
              id: true,
              firstName: true,
              lastName: true,
              secondLastName: true,
              enrollmentNumber: true,
              enrolledAt: true,
              withdrawnAt: true,
            },
            orderBy: [{ enrollmentNumber: 'asc' }],
          },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { courseId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
        select: { studentId: true, date: true, status: true },
      }),
    ]);

    if (!course) throw new NotFoundException('Curso no encontrado');

    const statsByStudent = new Map<
      string,
      { total: number; present: number; absent: number; late: number; justified: number }
    >();
    for (const student of course.students) {
      statsByStudent.set(student.id, { total: 0, present: 0, absent: 0, late: 0, justified: 0 });
    }

    for (const record of records) {
      const stats = statsByStudent.get(record.studentId);
      if (!stats || record.status === 'WITHDRAWN') continue;
      if (record.status === 'PRESENT') stats.present++;
      else if (record.status === 'ABSENT') stats.absent++;
      else if (record.status === 'LATE') {
        stats.late++;
        stats.present++;
      } else if (record.status === 'JUSTIFIED') {
        stats.justified++;
        stats.present++;
      }
    }

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const cappedRanges = ranges.map((r) => ({
      from: r.from,
      to: r.to < today ? r.to : today,
    }));

    const students = course.students.map((student) => {
      const stats = statsByStudent.get(student.id)!;
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(student, cappedRanges);
      const rate = activeDays > 0 ? stats.present / activeDays : null;
      return {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        secondLastName: student.secondLastName,
        enrollmentNumber: student.enrollmentNumber,
        total: activeDays,
        present: stats.present,
        absent: stats.absent,
        late: stats.late,
        justified: stats.justified,
        rate,
      };
    });

    return {
      students,
      period: {
        label: resolved.label,
        source: resolved.source,
        from: this.schoolConfig.formatDate(ranges[0]!.from),
        to: this.schoolConfig.formatDate(ranges[ranges.length - 1]!.to),
        ranges: ranges.map((range) => ({
          from: this.schoolConfig.formatDate(range.from),
          to: this.schoolConfig.formatDate(range.to),
        })),
      },
    };
  }

  async getMonthlyBreakdown(
    courseId: string,
    year: number,
    period: 'semester' | 'annual',
    semester?: 1 | 2,
  ) {
    const courseHead = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { schoolId: true },
    });
    if (!courseHead) throw new NotFoundException('Curso no encontrado');

    const resolved =
      period === 'semester'
        ? await this.schoolConfig.getSemesterPeriod(courseHead.schoolId, year, semester ?? 1)
        : await this.schoolConfig.getAnnualPeriod(courseHead.schoolId, year);

    const ranges = resolved.ranges;
    const monthRanges = this.schoolConfig.monthsForRanges(ranges);

    const [course, records] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          students: {
            where: this.schoolConfig.activeDuringRangesWhere(ranges),
            select: {
              id: true,
              firstName: true,
              lastName: true,
              secondLastName: true,
              enrollmentNumber: true,
              enrolledAt: true,
              withdrawnAt: true,
            },
            orderBy: [{ enrollmentNumber: 'asc' }],
          },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { courseId, ...this.schoolConfig.attendanceWhereForRanges(ranges) },
        select: { studentId: true, date: true, status: true },
      }),
    ]);

    if (!course) throw new NotFoundException('Curso no encontrado');

    const recordsByStudentAndDate = new Map<string, Map<string, string>>();
    for (const r of records) {
      if (r.status === 'WITHDRAWN') continue;
      if (!recordsByStudentAndDate.has(r.studentId)) {
        recordsByStudentAndDate.set(r.studentId, new Map());
      }
      const dateKey = this.schoolConfig.formatDate(r.date);
      recordsByStudentAndDate.get(r.studentId)!.set(dateKey, r.status);
    }

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const months = monthRanges.map((mr) => {
      const cappedTo = mr.to < today ? mr.to : today;
      const monthFrom = { from: mr.from, to: cappedTo };
      const stats: Record<
        string,
        {
          total: number;
          present: number;
          absent: number;
          late: number;
          justified: number;
          rate: number | null;
        }
      > = {};

      for (const student of course.students) {
        const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(student, [monthFrom]);
        const studentRecords = recordsByStudentAndDate.get(student.id);

        let present = 0;
        let absent = 0;
        let late = 0;
        let justified = 0;

        if (studentRecords) {
          const fromKey = this.schoolConfig.formatDate(mr.from);
          const toKey = this.schoolConfig.formatDate(mr.to);
          for (const [dateKey, status] of studentRecords) {
            if (dateKey < fromKey || dateKey > toKey) continue;
            if (status === 'PRESENT') present++;
            else if (status === 'ABSENT') absent++;
            else if (status === 'LATE') {
              late++;
              present++;
            } else if (status === 'JUSTIFIED') {
              justified++;
              present++;
            }
          }
        }

        const rate = activeDays > 0 ? present / activeDays : null;
        stats[student.id] = { total: activeDays, present, absent, late, justified, rate };
      }

      return {
        month: mr.month,
        year: mr.from.getFullYear(),
        from: this.schoolConfig.formatDate(mr.from),
        to: this.schoolConfig.formatDate(mr.to),
        stats,
      };
    });

    const students = course.students.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      secondLastName: s.secondLastName,
      enrollmentNumber: s.enrollmentNumber,
    }));

    return {
      students,
      months,
      period: {
        label: resolved.label,
        source: resolved.source,
        from: this.schoolConfig.formatDate(ranges[0]!.from),
        to: this.schoolConfig.formatDate(ranges[ranges.length - 1]!.to),
        ranges: ranges.map((range) => ({
          from: this.schoolConfig.formatDate(range.from),
          to: this.schoolConfig.formatDate(range.to),
        })),
      },
    };
  }

  async getMissingAttendance(schoolId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const [courses, nonSchoolDays] = await Promise.all([
      this.prisma.course.findMany({
        where: { schoolId, active: true },
        select: { id: true, code: true, name: true },
      }),
      this.calendar.getNonSchoolDays(schoolId, fromDate, toDate),
    ]);

    if (courses.length === 0) return [];

    const courseIds = courses.map((c) => c.id);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        courseId: { in: courseIds },
        date: { gte: fromDate, lte: toDate },
      },
      select: { courseId: true, date: true },
    });

    const recordsByCourse = new Map<string, Set<string>>();
    for (const r of records) {
      const dateKey = r.date.toISOString().split('T')[0]!;
      if (!recordsByCourse.has(r.courseId)) {
        recordsByCourse.set(r.courseId, new Set());
      }
      recordsByCourse.get(r.courseId)!.add(dateKey);
    }

    const schoolDays: string[] = [];
    const current = new Date(fromDate);
    while (current <= toDate) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dateKey = current.toISOString().split('T')[0]!;
        if (!nonSchoolDays.has(dateKey)) {
          schoolDays.push(dateKey);
        }
      }
      current.setDate(current.getDate() + 1);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.toISOString().split('T')[0]!;
    const pastSchoolDays = schoolDays.filter((d) => d < todayKey);

    if (pastSchoolDays.length === 0) return [];

    return courses
      .map((course) => {
        const courseRecords = recordsByCourse.get(course.id) ?? new Set<string>();
        const missingDates = pastSchoolDays.filter((d) => !courseRecords.has(d));
        return {
          courseId: course.id,
          courseCode: course.code,
          courseName: course.name,
          missingDates,
        };
      })
      .filter((c) => c.missingDates.length > 0)
      .sort((a, b) => b.missingDates.length - a.missingDates.length);
  }

  async assertCanAccessStudent(studentId: string, user: JwtPayload): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        schoolId: true,
        courseId: true,
        guardianships: { select: { guardianId: true } },
      },
    });
    if (!student) throw new NotFoundException('Alumno no encontrado');

    if (user.roles.includes(SystemRole.SUPER_ADMIN)) return;
    if (
      user.schoolId === student.schoolId &&
      [SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA].some((role) =>
        user.roles.includes(role),
      )
    ) {
      return;
    }
    if (
      user.roles.includes(SystemRole.APODERADO) &&
      student.guardianships.some((g) => g.guardianId === user.sub)
    ) {
      return;
    }
    if (user.roles.includes(SystemRole.PROFESOR)) {
      const assigned = await this.prisma.courseTeacher.findUnique({
        where: { courseId_userId: { courseId: student.courseId, userId: user.sub } },
        select: { id: true },
      });
      if (assigned) return;
    }

    throw new ForbiddenException('Sin acceso a este alumno');
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
