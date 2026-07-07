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
import {
  chileTodayEndUtc,
  chileTodayKey,
  expandDateOnlyRange,
  parseDateOnlyUtc,
} from '../common/date-only.js';
import { SchoolConfigService } from '../school-config/school-config.service.js';
import type { RecordAttendanceDto } from './dto/record-attendance.dto.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import {
  ATTENDANCE_FORMULA_VERSION,
  addAttendanceStatus,
  buildAttendanceSummary,
  countsAsAttendance,
  emptyAttendanceCounts,
  type AttendanceCounts,
} from './attendance-calculation.js';

type ExistingAttendanceRecord = {
  id: string;
  studentId: string;
  date: Date;
  status: AttendanceStatus;
  lateMinutes: number | null;
  note: string | null;
};

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
    await this.assertSchoolDay(dto.courseId, date);
    const activeStudentIds = await this.assertEntriesBelongToCourse(dto, date);
    const existingRecords = await this.findExistingRecordsForDate(
      dto.courseId,
      dto.date,
      activeStudentIds,
    );
    await this.assertDailyAttendanceComplete(dto, activeStudentIds, existingRecords);
    const changeAudit = await this.buildAttendanceChangeAudit(dto, existingRecords, recordedById);
    const existingByStudent = new Map(existingRecords.map((record) => [record.studentId, record]));

    const writes = dto.entries.map((entry) => {
      const existing = existingByStudent.get(entry.studentId);
      const data = {
        status: entry.status as AttendanceStatus,
        note: entry.note ?? null,
        lateMinutes: entry.lateMinutes ?? null,
        recordedById,
      };
      return existing
        ? this.prisma.attendanceRecord.update({
            where: { id: existing.id },
            data: { ...data, updatedAt: new Date() },
          })
        : this.prisma.attendanceRecord.create({
            data: {
              studentId: entry.studentId,
              courseId: dto.courseId,
              date,
              ...data,
            },
          });
    });

    await this.prisma.$transaction(writes);

    await this.audit.log({
      userId: recordedById,
      action: 'UPDATE',
      entity: 'AttendanceRecord',
      entityId: dto.courseId,
      meta: {
        date: dto.date,
        count: dto.entries.length,
        ...changeAudit,
      },
    });

    void this.notifyGuardiansAbsence(dto, date).catch((e) =>
      this.log.warn(`notifyGuardiansAbsence failed: ${e instanceof Error ? e.message : String(e)}`),
    );

    return { upserted: dto.entries.length };
  }

  /**
   * La grilla ya bloquea días no lectivos en el cliente; esto cierra la vía
   * directa por API. Un registro en día no lectivo queda fuera de todas las
   * estadísticas y bloquea guardar la configuración de semestres.
   */
  private async assertSchoolDay(courseId: string, date: Date): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { schoolId: true },
    });
    if (!course) throw new NotFoundException('Curso no encontrado');
    const nonSchool = await this.calendar.getNonSchoolDays(course.schoolId, date, date);
    const dateKey = this.schoolConfig.formatDate(date);
    if (nonSchool.has(dateKey)) {
      throw new BadRequestException(
        'No se puede registrar asistencia en un día no lectivo (feriado, suspensión o vacaciones)',
      );
    }
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

  private async findExistingRecordsForDate(
    courseId: string,
    dateKey: string,
    studentIds: Set<string>,
  ): Promise<ExistingAttendanceRecord[]> {
    const date = parseDateOnlyUtc(dateKey);
    const range = expandDateOnlyRange(date, date);
    const candidates = await this.prisma.attendanceRecord.findMany({
      where: {
        courseId,
        date: { gte: range.from, lte: range.to },
        studentId: { in: Array.from(studentIds) },
      },
      select: {
        id: true,
        studentId: true,
        date: true,
        status: true,
        lateMinutes: true,
        note: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const byStudent = new Map<string, ExistingAttendanceRecord>();
    for (const record of candidates) {
      if (this.schoolConfig.formatDate(record.date) !== dateKey) continue;
      if (!byStudent.has(record.studentId)) byStudent.set(record.studentId, record);
    }
    return Array.from(byStudent.values());
  }

  private async assertDailyAttendanceComplete(
    dto: RecordAttendanceDto,
    activeStudentIds: Set<string>,
    existingRecords: ExistingAttendanceRecord[],
  ) {
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

  private async buildAttendanceChangeAudit(
    dto: RecordAttendanceDto,
    existingRecordsForDate: ExistingAttendanceRecord[],
    recordedById: string,
  ) {
    const studentIds = dto.entries.map((entry) => entry.studentId);
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: {
        id: true,
        code: true,
        name: true,
        schoolId: true,
        students: {
          where: { id: { in: studentIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            secondLastName: true,
            enrollmentNumber: true,
          },
        },
      },
    });

    const entryStudentIds = new Set(studentIds);
    const existingByStudent = new Map(
      existingRecordsForDate
        .filter((record) => entryStudentIds.has(record.studentId))
        .map((record) => [record.studentId, record]),
    );
    const studentsById = new Map((course?.students ?? []).map((student) => [student.id, student]));
    const changedAt = new Date().toISOString();
    const changes = dto.entries
      .map((entry) => {
        const previous = existingByStudent.get(entry.studentId);
        const newStatus = entry.status as AttendanceStatus;
        const newLateMinutes = entry.lateMinutes ?? null;
        const newNote = entry.note ?? null;
        const changedFields: string[] = [];

        if (!previous) {
          changedFields.push('created');
        } else {
          if (previous.status !== newStatus) changedFields.push('status');
          if ((previous.lateMinutes ?? null) !== newLateMinutes) changedFields.push('lateMinutes');
          if ((previous.note ?? null) !== newNote) changedFields.push('note');
        }

        if (changedFields.length === 0) return null;

        const student = studentsById.get(entry.studentId);
        return {
          courseId: dto.courseId,
          courseCode: course?.code ?? null,
          courseName: course?.name ?? null,
          schoolId: course?.schoolId ?? null,
          date: dto.date,
          studentId: entry.studentId,
          studentName: student
            ? [student.firstName, student.lastName, student.secondLastName]
                .filter(Boolean)
                .join(' ')
            : null,
          enrollmentNumber: student?.enrollmentNumber ?? null,
          previousStatus: previous?.status ?? null,
          newStatus,
          previousLateMinutes: previous?.lateMinutes ?? null,
          newLateMinutes,
          changedFields,
          noteChanged: changedFields.includes('note'),
        };
      })
      .filter((change): change is NonNullable<typeof change> => change !== null);

    return {
      attendanceChange: changes.length > 0,
      changedAt,
      recordedById,
      changes,
    };
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
    const dateKey = this.schoolConfig.formatDate(date);
    if (nonSchool.has(dateKey)) return;

    const studentIds = toNotify.map((e) => e.studentId);
    const range = expandDateOnlyRange(date, date);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { date: { gte: range.from, lte: range.to }, studentId: { in: studentIds } },
      select: {
        id: true,
        studentId: true,
        date: true,
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
    const recordsForDate = records.filter(
      (record) => this.schoolConfig.formatDate(record.date) === dateKey,
    );

    const now = new Date();
    for (const rec of recordsForDate) {
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
    const parsed = parseDateOnlyUtc(date);
    const range = expandDateOnlyRange(parsed, parsed);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: range.from, lte: range.to } },
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
    return records.filter((record) => this.schoolConfig.formatDate(record.date) === date);
  }

  async getByStudent(studentId: string, from?: string, to?: string) {
    const fromDate = from ? parseDateOnlyUtc(from) : undefined;
    const toDate = to ? this.endOfDateOnly(to) : undefined;
    const range = fromDate && toDate ? expandDateOnlyRange(fromDate, toDate) : null;
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        studentId,
        ...(range || fromDate || toDate
          ? {
              date: {
                ...(range ? { gte: range.from } : fromDate ? { gte: fromDate } : {}),
                ...(range ? { lte: range.to } : toDate ? { lte: toDate } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    });
    return records.filter((record) => {
      const key = this.schoolConfig.formatDate(record.date);
      return (!from || key >= from) && (!to || key <= to);
    });
  }

  /** Course summary: group by date, calc rates. */
  async getCourseMonthSummary(courseId: string, year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // last day
    const range = expandDateOnlyRange(from, to);
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: range.from, lte: range.to } },
      select: { date: true, status: true, studentId: true },
    });

    // Group by date
    const byDate = new Map<
      string,
      { present: number; absent: number; late: number; justified: number; total: number }
    >();
    for (const r of records) {
      const key = this.schoolConfig.formatDate(r.date);
      if (!key.startsWith(monthPrefix)) continue;
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
      attendanceRate: counts.total > 0 ? (counts.present + counts.late) / counts.total : 0,
      totalClasses: counts.total,
      missing: 0,
      formulaVersion: ATTENDANCE_FORMULA_VERSION,
    }));
  }

  /** School-level stats per course for a given period. */
  async getSchoolStats(schoolId: string, from: string, to: string) {
    const fromDate = parseDateOnlyUtc(from);
    const toDate = this.endOfDateOnly(to);
    const today = chileTodayEndUtc();
    const cappedToDate = toDate < today ? toDate : today;

    const [courses, nonSchool] = await Promise.all([
      this.prisma.course.findMany({
        where: { schoolId, active: true },
        select: {
          id: true,
          code: true,
          name: true,
          students: {
            where: {
              enrolledAt: { lte: cappedToDate },
              firstName: { not: '[Eliminado]' },
              OR: [{ withdrawnAt: null }, { withdrawnAt: { gte: fromDate } }],
            },
            select: { enrolledAt: true, withdrawnAt: true },
          },
        },
      }),
      this.calendar.getNonSchoolDays(schoolId, fromDate, cappedToDate),
    ]);

    const courseIds = courses.map((course) => course.id);
    const queryRange = expandDateOnlyRange(fromDate, cappedToDate);
    const fromKey = this.schoolConfig.formatDate(fromDate);
    const toKey = this.schoolConfig.formatDate(cappedToDate);

    const records =
      courseIds.length === 0
        ? []
        : await this.prisma.attendanceRecord.findMany({
            where: {
              courseId: { in: courseIds },
              date: { gte: queryRange.from, lte: queryRange.to },
            },
            select: { courseId: true, date: true, status: true },
          });

    const byCourse = new Map<string, AttendanceCounts>();
    for (const record of records) {
      const key = this.schoolConfig.formatDate(record.date);
      if (key < fromKey || key > toKey || nonSchool.has(key)) continue;
      const cur = byCourse.get(record.courseId) ?? emptyAttendanceCounts();
      addAttendanceStatus(cur, record.status);
      byCourse.set(record.courseId, cur);
    }

    return courses
      .map((c) => {
        const agg = byCourse.get(c.id) ?? emptyAttendanceCounts();
        const courseTotalClasses = c.students.reduce(
          (total, student) =>
            total +
            this.schoolConfig.countActiveSchoolDaysInRanges(
              student,
              [{ from: fromDate, to: cappedToDate }],
              nonSchool,
            ),
          0,
        );
        const summary = buildAttendanceSummary(agg, courseTotalClasses);
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          total: summary.totalClasses,
          present: summary.present,
          late: summary.late,
          absent: summary.absent,
          justified: summary.justified,
          missing: summary.missing,
          attended: summary.attended,
          totalClasses: summary.totalClasses,
          attendanceRate: summary.attendanceRate ?? 0,
          formulaVersion: summary.formulaVersion,
        };
      })
      .sort((a, b) => b.attendanceRate - a.attendanceRate);
  }

  async getCourseDailyTrend(courseId: string, from: string, to: string) {
    const fromDate = parseDateOnlyUtc(from);
    const toDate = this.endOfDateOnly(to);
    const range = expandDateOnlyRange(fromDate, toDate);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: range.from, lte: range.to } },
      select: { date: true, status: true },
      orderBy: { date: 'asc' },
    });

    const fromKey = this.schoolConfig.formatDate(fromDate);
    const toKey = this.schoolConfig.formatDate(toDate);
    const byDate = new Map<string, { total: number; present: number }>();
    for (const r of records) {
      const d = this.schoolConfig.formatDate(r.date);
      if (d < fromKey || d > toKey) continue;
      const cur = byDate.get(d) ?? { total: 0, present: 0 };
      cur.total += 1;
      if (countsAsAttendance(r.status)) cur.present += 1;
      byDate.set(d, cur);
    }

    return Array.from(byDate.entries()).map(([date, agg]) => ({
      date,
      total: agg.total,
      present: agg.present,
      rate: agg.total > 0 ? agg.present / agg.total : 0,
      attendanceRate: agg.total > 0 ? agg.present / agg.total : 0,
      totalClasses: agg.total,
      missing: 0,
      formulaVersion: ATTENDANCE_FORMULA_VERSION,
    }));
  }

  async getCourseMatrix(courseId: string, year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const queryRange = expandDateOnlyRange(from, to);
    const today = chileTodayEndUtc();
    const cappedTo = to < today ? to : today;

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
        where: { courseId, date: { gte: queryRange.from, lte: queryRange.to } },
        select: { studentId: true, date: true, status: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    if (!course) throw new NotFoundException('Curso no encontrado');

    // Build ALL weekday dates for the month (Mon-Fri)
    const allDates: string[] = [];
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(Date.UTC(year, month - 1, d));
      const dow = dt.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        allDates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }

    // Fetch non-school days (holidays, suspended) for the month
    const nonSchoolDaysSet = await this.calendar.getNonSchoolDays(course.schoolId, from, to);

    const nonSchoolDays = await this.calendar.getNonSchoolDayDetails(course.schoolId, from, to);

    // School days = weekdays minus non-school days
    const schoolDays = allDates.filter((d) => !nonSchoolDaysSet.has(d));

    // Use allDates (all weekdays) as column reference, but keep backward compat via `dates`
    const dates = allDates;

    const matrix: Record<string, Record<string, string>> = {};
    records.forEach((r) => {
      const date = this.schoolConfig.formatDate(r.date);
      if (!allDates.includes(date)) return;
      if (!matrix[r.studentId]) matrix[r.studentId] = {};
      matrix[r.studentId]![date] = r.status;
    });

    const studentStats = course.students.map((s) => {
      for (const dateKey of dates) {
        const date = parseDateOnlyUtc(dateKey);
        if (s.withdrawnAt && this.startOfDay(s.withdrawnAt) <= date) {
          if (!matrix[s.id]) matrix[s.id] = {};
          matrix[s.id]![dateKey] = 'WITHDRAWN';
        }
      }
      const totalClasses = this.schoolConfig.countActiveSchoolDaysInRanges(
        s,
        [{ from, to: cappedTo }],
        nonSchoolDaysSet,
      );
      const effectiveSchoolDays = new Set(
        schoolDays.filter((dateKey) => dateKey <= this.schoolConfig.formatDate(cappedTo)),
      );
      const counts = emptyAttendanceCounts();
      for (const [dateKey, status] of Object.entries(matrix[s.id] ?? {})) {
        if (!effectiveSchoolDays.has(dateKey) || status === 'WITHDRAWN') continue;
        const date = parseDateOnlyUtc(dateKey);
        if (date < this.startOfDay(s.enrolledAt)) continue;
        if (s.withdrawnAt && date > this.startOfDay(s.withdrawnAt)) continue;
        addAttendanceStatus(counts, status);
      }
      const summary = buildAttendanceSummary(counts, totalClasses);
      return {
        ...s,
        total: summary.totalClasses,
        present: summary.present,
        absent: summary.absent,
        late: summary.late,
        justified: summary.justified,
        missing: summary.missing,
        attended: summary.attended,
        totalClasses: summary.totalClasses,
        attendanceRate: summary.attendanceRate,
        formulaVersion: summary.formulaVersion,
        rate: summary.attendanceRate,
      };
    });

    const todayKey = this.schoolConfig.formatDate(today);

    return { students: studentStats, dates, matrix, nonSchoolDays, schoolDays, today: todayKey };
  }

  async getCourseSummary(courseId: string, from: string, to: string) {
    const fromDate = new Date(from + 'T00:00:00.000Z');
    const toDate = new Date(to + 'T23:59:59.999Z');
    const today = chileTodayEndUtc();
    const cappedToDate = toDate < today ? toDate : today;

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
        where: { courseId, date: { gte: fromDate, lte: cappedToDate } },
        select: { studentId: true, date: true, status: true },
      }),
    ]);

    if (!course) throw new NotFoundException('Curso no encontrado');
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      course.schoolId,
      fromDate,
      cappedToDate,
    );

    const statsByStudent = new Map<string, AttendanceCounts>();
    for (const s of course.students) {
      statsByStudent.set(s.id, emptyAttendanceCounts());
    }

    for (const r of records) {
      const stats = statsByStudent.get(r.studentId);
      if (!stats) continue;
      if (r.status === 'WITHDRAWN') continue;
      addAttendanceStatus(stats, r.status);
    }

    const students = course.students.map((s) => {
      const stats = statsByStudent.get(s.id)!;
      const totalClasses = this.schoolConfig.countActiveSchoolDaysInRanges(
        s,
        [{ from: fromDate, to: cappedToDate }],
        nonSchoolDays,
      );
      const summary = buildAttendanceSummary(stats, totalClasses);
      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        secondLastName: s.secondLastName,
        enrollmentNumber: s.enrollmentNumber,
        total: summary.totalClasses,
        present: summary.present,
        absent: summary.absent,
        late: summary.late,
        justified: summary.justified,
        missing: summary.missing,
        attended: summary.attended,
        totalClasses: summary.totalClasses,
        attendanceRate: summary.attendanceRate,
        formulaVersion: summary.formulaVersion,
        rate: summary.attendanceRate,
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
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );

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

    const statsByStudent = new Map<string, AttendanceCounts>();
    for (const student of course.students) {
      statsByStudent.set(student.id, emptyAttendanceCounts());
    }

    const today = chileTodayEndUtc();
    for (const record of records) {
      const stats = statsByStudent.get(record.studentId);
      if (!stats || record.status === 'WITHDRAWN') continue;
      if (record.date > today) continue;
      addAttendanceStatus(stats, record.status);
    }

    const cappedRanges = ranges.map((r) => ({
      from: r.from,
      to: r.to < today ? r.to : today,
    }));

    const students = course.students.map((student) => {
      const stats = statsByStudent.get(student.id)!;
      const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
        student,
        cappedRanges,
        nonSchoolDays,
      );
      const summary = buildAttendanceSummary(stats, activeDays);
      return {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        secondLastName: student.secondLastName,
        enrollmentNumber: student.enrollmentNumber,
        total: summary.totalClasses,
        present: summary.present,
        absent: summary.absent,
        late: summary.late,
        justified: summary.justified,
        missing: summary.missing,
        attended: summary.attended,
        totalClasses: summary.totalClasses,
        attendanceRate: summary.attendanceRate,
        formulaVersion: summary.formulaVersion,
        rate: summary.attendanceRate,
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
    const nonSchoolDays = await this.calendar.getNonSchoolDays(
      courseHead.schoolId,
      ranges[0]!.from,
      ranges[ranges.length - 1]!.to,
    );
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

    const today = chileTodayEndUtc();

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
          missing: number;
          attended: number;
          totalClasses: number;
          attendanceRate: number | null;
          formulaVersion: string;
          rate: number | null;
        }
      > = {};

      for (const student of course.students) {
        const activeDays = this.schoolConfig.countActiveSchoolDaysInRanges(
          student,
          [monthFrom],
          nonSchoolDays,
        );
        const studentRecords = recordsByStudentAndDate.get(student.id);

        const counts = emptyAttendanceCounts();

        if (studentRecords) {
          const fromKey = this.schoolConfig.formatDate(mr.from);
          const toKey = this.schoolConfig.formatDate(cappedTo);
          for (const [dateKey, status] of studentRecords) {
            if (dateKey < fromKey || dateKey > toKey) continue;
            addAttendanceStatus(counts, status);
          }
        }

        const summary = buildAttendanceSummary(counts, activeDays);
        stats[student.id] = {
          total: summary.totalClasses,
          present: summary.present,
          absent: summary.absent,
          late: summary.late,
          justified: summary.justified,
          missing: summary.missing,
          attended: summary.attended,
          totalClasses: summary.totalClasses,
          attendanceRate: summary.attendanceRate,
          formulaVersion: summary.formulaVersion,
          rate: summary.attendanceRate,
        };
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
    const fromDate = parseDateOnlyUtc(from);
    const toDate = parseDateOnlyUtc(to);
    const queryRange = expandDateOnlyRange(fromDate, toDate);

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
        date: { gte: queryRange.from, lte: queryRange.to },
      },
      select: { courseId: true, date: true },
    });

    const recordsByCourse = new Map<string, Set<string>>();
    for (const r of records) {
      const dateKey = this.schoolConfig.formatDate(r.date);
      if (dateKey < from || dateKey > to) continue;
      if (!recordsByCourse.has(r.courseId)) {
        recordsByCourse.set(r.courseId, new Set());
      }
      recordsByCourse.get(r.courseId)!.add(dateKey);
    }

    const schoolDays: string[] = [];
    const current = new Date(fromDate);
    while (current <= toDate) {
      const dayOfWeek = current.getUTCDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dateKey = this.schoolConfig.formatDate(current);
        if (!nonSchoolDays.has(dateKey)) {
          schoolDays.push(dateKey);
        }
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    const todayKey = chileTodayKey();
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
    return parseDateOnlyUtc(this.schoolConfig.formatDate(date));
  }

  private endOfDateOnly(value: string): Date {
    const date = parseDateOnlyUtc(value);
    date.setUTCHours(23, 59, 59, 999);
    return date;
  }
}
