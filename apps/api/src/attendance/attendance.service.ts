import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SystemRole, type AttendanceStatus } from '@prisma/client';

import { CalendarService } from '../calendar/calendar.service.js';
import { MailService } from '../mail/mail.service.js';
import { WhatsAppService } from '../mail/whatsapp.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
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
  ) {}

  /** Bulk upsert daily attendance for a course. Idempotent — safe to call multiple times. */
  async recordBulk(dto: RecordAttendanceDto, recordedById: string): Promise<{ upserted: number }> {
    const date = new Date(dto.date);

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
      this.log.warn(`notifyGuardiansAbsence failed: ${(e as Error).message}`),
    );

    return { upserted: dto.entries.length };
  }

  private async notifyGuardiansAbsence(dto: RecordAttendanceDto, date: Date) {
    const toNotify = dto.entries.filter((e) => e.status === 'ABSENT' || e.status === 'LATE');
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

    for (const rec of records) {
      if (rec.status !== 'ABSENT' && rec.status !== 'LATE') continue;
      const primary = rec.student.guardianships.find(
        (g) => g.isPrimary && g.guardian.status === 'ACTIVE' && !g.guardian.deletedAt,
      );
      const guardians = primary
        ? [primary]
        : rec.student.guardianships.filter(
            (g) => g.guardian.status === 'ACTIVE' && !g.guardian.deletedAt,
          );
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
          select: { id: true, firstName: true, lastName: true, enrollmentNumber: true, rut: true },
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
      attendanceRate: counts.total > 0 ? (counts.present + counts.late) / counts.total : 0,
    }));
  }

  /** School-level stats per course for a given period. */
  async getSchoolStats(schoolId: string, from: string, to: string) {
    const courses = await this.prisma.course.findMany({
      where: { schoolId, active: true },
      select: { id: true, code: true, name: true },
    });

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const nonSchool = await this.calendar.getNonSchoolDays(schoolId, fromDate, toDate);
    const stats = await Promise.all(
      courses.map(async (course) => {
        const recs = await this.prisma.attendanceRecord.findMany({
          where: { courseId: course.id, date: { gte: fromDate, lte: toDate } },
          select: { status: true, date: true },
        });
        const filtered = recs.filter((r) => !nonSchool.has(r.date.toISOString().split('T')[0]!));
        const total = filtered.length;
        const present = filtered.filter(
          (r) => r.status === 'PRESENT' || r.status === 'LATE',
        ).length;
        return { ...course, total, present, attendanceRate: total > 0 ? present / total : 0 };
      }),
    );

    return stats.sort((a, b) => b.attendanceRate - a.attendanceRate);
  }

  async getCourseMatrix(courseId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const [course, records] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          students: {
            where: { active: true },
            select: { id: true, firstName: true, lastName: true, enrollmentNumber: true },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
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

    const dateSet = new Set<string>();
    records.forEach((r) => dateSet.add(r.date.toISOString().split('T')[0]!));
    const dates = Array.from(dateSet).sort();

    const matrix: Record<string, Record<string, string>> = {};
    records.forEach((r) => {
      const date = r.date.toISOString().split('T')[0]!;
      if (!matrix[r.studentId]) matrix[r.studentId] = {};
      matrix[r.studentId]![date] = r.status;
    });

    const studentStats = course.students.map((s) => {
      const studentRecords = Object.values(matrix[s.id] ?? {});
      const total = studentRecords.length;
      const present = studentRecords.filter((st) => st === 'PRESENT' || st === 'LATE').length;
      const absent = studentRecords.filter((st) => st === 'ABSENT').length;
      const justified = studentRecords.filter((st) => st === 'JUSTIFIED').length;
      return { ...s, total, present, absent, justified, rate: total > 0 ? present / total : null };
    });

    return { students: studentStats, dates, matrix };
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
      [SystemRole.DIRECTOR, SystemRole.UTP].some((role) => user.roles.includes(role))
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
}
