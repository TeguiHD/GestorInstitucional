import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AlertTrigger } from '@prisma/client';

import {
  addAttendanceStatus,
  buildAttendanceSummary,
  countsAsAttendance,
  emptyAttendanceCounts,
} from '../attendance/attendance-calculation.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { SchoolConfigService } from '../school-config/school-config.service.js';

@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly calendar: CalendarService,
    private readonly schoolConfig: SchoolConfigService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async listRules(schoolId: string) {
    return this.prisma.alertRule.findMany({ where: { schoolId }, orderBy: { trigger: 'asc' } });
  }

  async upsertRule(dto: {
    schoolId: string;
    trigger: AlertTrigger;
    threshold?: number;
    windowDays?: number;
    enabled?: boolean;
    notifyRoles?: string[];
  }) {
    return this.prisma.alertRule.upsert({
      where: { schoolId_trigger: { schoolId: dto.schoolId, trigger: dto.trigger } },
      update: {
        threshold: dto.threshold ?? null,
        windowDays: dto.windowDays ?? 30,
        enabled: dto.enabled ?? true,
        notifyRoles: JSON.stringify(dto.notifyRoles ?? ['DIRECTOR', 'UTP', 'INSPECTORIA']),
      },
      create: {
        schoolId: dto.schoolId,
        trigger: dto.trigger,
        threshold: dto.threshold ?? null,
        windowDays: dto.windowDays ?? 30,
        enabled: dto.enabled ?? true,
        notifyRoles: JSON.stringify(dto.notifyRoles ?? ['DIRECTOR', 'UTP', 'INSPECTORIA']),
      },
    });
  }

  async deleteRule(id: string, schoolId: string) {
    const rule = await this.prisma.alertRule.findUnique({ where: { id } });
    if (!rule || rule.schoolId !== schoolId) throw new NotFoundException('Regla no encontrada');
    await this.prisma.alertRule.delete({ where: { id } });
    return { ok: true };
  }

  // ── DAILY JOB (runs at 07:00 CLT = 10:00 UTC) ────────────────────────────

  @Cron('0 10 * * 1-5') // Mon–Fri 10:00 UTC
  async runDailyAlerts() {
    this.log.log('Running daily alert checks');
    const schools = await this.prisma.school.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });
    for (const school of schools) {
      await this.checkSchool(school.id, school.name).catch((e) =>
        this.log.warn(`Alert check failed for school ${school.id}: ${(e as Error).message}`),
      );
    }
    this.log.log('Daily alert checks complete');
  }

  /** Manually trigger alerts for a school (for testing / admin). */
  async triggerManual(schoolId: string): Promise<{ checked: number; fired: number }> {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('Colegio no encontrado');
    return this.checkSchool(schoolId, school.name);
  }

  async getRecentFired(schoolId: string, limit = 10) {
    return this.prisma.alertFired.findMany({
      where: { rule: { schoolId } },
      include: { rule: { select: { trigger: true, threshold: true } } },
      orderBy: { firedAt: 'desc' },
      take: limit,
    });
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────

  private async checkSchool(
    schoolId: string,
    schoolName: string,
  ): Promise<{ checked: number; fired: number }> {
    const rules = await this.prisma.alertRule.findMany({
      where: { schoolId, enabled: true },
    });

    let checked = 0;
    let fired = 0;

    for (const rule of rules) {
      checked++;
      const f = await this.evaluateRule(rule, schoolId, schoolName).catch((e) => {
        this.log.warn(`Rule ${rule.id} eval error: ${(e as Error).message}`);
        return 0;
      });
      fired += f;
    }
    return { checked, fired };
  }

  private async evaluateRule(
    rule: {
      id: string;
      trigger: AlertTrigger;
      threshold: number | null;
      windowDays: number;
      notifyRoles: unknown;
    },
    schoolId: string,
    schoolName: string,
  ): Promise<number> {
    const to = this.endOfLocalDay(new Date());
    const from = this.startOfLocalDay(to);
    from.setDate(from.getDate() - Math.max(0, rule.windowDays - 1));
    const roles: string[] = Array.isArray(rule.notifyRoles)
      ? (rule.notifyRoles as string[])
      : JSON.parse(rule.notifyRoles as string);

    switch (rule.trigger) {
      case 'STUDENT_BELOW_THRESHOLD':
        return this.checkStudentThreshold(
          rule.id,
          schoolId,
          schoolName,
          from,
          to,
          rule.threshold ?? 0.85,
          roles,
        );
      case 'COURSE_BELOW_THRESHOLD':
        return this.checkCourseThreshold(
          rule.id,
          schoolId,
          schoolName,
          from,
          to,
          rule.threshold ?? 0.85,
          roles,
        );
      case 'STUDENT_CONSECUTIVE_ABSENCES':
        return this.checkConsecutiveAbsences(
          rule.id,
          schoolId,
          schoolName,
          from,
          to,
          rule.threshold ?? 3,
          roles,
        );
      case 'TEACHER_NO_RECORD':
        return this.checkTeacherNoRecord(rule.id, schoolId, schoolName, rule.threshold ?? 2, roles);
    }
  }

  private async checkStudentThreshold(
    ruleId: string,
    schoolId: string,
    schoolName: string,
    from: Date,
    to: Date,
    threshold: number,
    roles: string[],
  ): Promise<number> {
    const ranges = [{ from, to }];
    const [students, nonSchool] = await Promise.all([
      this.prisma.student.findMany({
        where: {
          schoolId,
          ...this.schoolConfig.activeDuringRangesWhere(ranges),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          rut: true,
          enrolledAt: true,
          withdrawnAt: true,
        },
      }),
      this.calendar.getNonSchoolDays(schoolId, from, to),
    ]);

    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, date: { gte: from, lte: to } },
      select: {
        studentId: true,
        status: true,
        date: true,
      },
    });

    const byStudent = new Map(students.map((student) => [student.id, emptyAttendanceCounts()]));
    for (const r of this.filterSchoolRecords(records, nonSchool)) {
      const counts = byStudent.get(r.studentId);
      if (counts) addAttendanceStatus(counts, r.status);
    }

    const atRisk = students
      .map((student) => {
        const totalClasses = this.schoolConfig.countActiveSchoolDaysInRanges(
          student,
          ranges,
          nonSchool,
        );
        const summary = buildAttendanceSummary(
          byStudent.get(student.id) ?? emptyAttendanceCounts(),
          totalClasses,
        );
        return {
          id: student.id,
          name: `${student.firstName} ${student.lastName}`,
          rut: student.rut,
          total: summary.totalClasses,
          totalClasses: summary.totalClasses,
          missing: summary.missing,
          rate: summary.attendanceRate ?? 0,
        };
      })
      .filter((s) => s.totalClasses >= 5 && s.rate < threshold);

    if (atRisk.length === 0) return 0;

    // Dedup: only fire if not already fired today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const alreadyFired = await this.prisma.alertFired.findFirst({
      where: { ruleId, firedAt: { gte: today } },
    });
    if (alreadyFired) return 0;

    await this.prisma.alertFired.create({
      data: { ruleId, entityType: 'school', entityId: schoolId, meta: { count: atRisk.length } },
    });

    await this.notifyRoleUsers(schoolId, roles, {
      subject: `⚠ ${atRisk.length} alumno${atRisk.length !== 1 ? 's' : ''} bajo ${(threshold * 100).toFixed(0)}% — ${schoolName}`,
      body:
        `Los siguientes alumnos tienen asistencia por debajo del ${(threshold * 100).toFixed(0)}% en los últimos ${Math.round((to.getTime() - from.getTime()) / 86_400_000)} días:\n\n` +
        atRisk
          .slice(0, 20)
          .map((s) => `• ${s.name} (${s.rut}): ${(s.rate * 100).toFixed(1)}%`)
          .join('\n') +
        (atRisk.length > 20 ? `\n…y ${atRisk.length - 20} más.` : ''),
    });

    return 1;
  }

  private async checkCourseThreshold(
    ruleId: string,
    schoolId: string,
    schoolName: string,
    from: Date,
    to: Date,
    threshold: number,
    roles: string[],
  ): Promise<number> {
    const ranges = [{ from, to }];
    const courses = await this.prisma.course.findMany({
      where: { schoolId, active: true },
      select: {
        id: true,
        code: true,
        name: true,
        students: {
          where: this.schoolConfig.activeDuringRangesWhere(ranges),
          select: { enrolledAt: true, withdrawnAt: true },
        },
      },
    });
    const nonSchool = await this.calendar.getNonSchoolDays(schoolId, from, to);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { course: { schoolId, active: true }, date: { gte: from, lte: to } },
      select: { courseId: true, status: true, date: true },
    });
    const byCourse = new Map<string, Array<(typeof records)[number]>>();
    for (const record of this.filterSchoolRecords(records, nonSchool)) {
      const bucket = byCourse.get(record.courseId) ?? [];
      bucket.push(record);
      byCourse.set(record.courseId, bucket);
    }

    const atRisk: Array<{ code: string; name: string; rate: number }> = [];
    for (const course of courses) {
      const counts = emptyAttendanceCounts();
      for (const record of byCourse.get(course.id) ?? [])
        addAttendanceStatus(counts, record.status);
      const totalClasses = course.students.reduce(
        (sum, student) =>
          sum + this.schoolConfig.countActiveSchoolDaysInRanges(student, ranges, nonSchool),
        0,
      );
      if (totalClasses < 10) continue;
      const summary = buildAttendanceSummary(counts, totalClasses);
      const rate = summary.attendanceRate ?? 0;
      if (rate < threshold) atRisk.push({ code: course.code, name: course.name, rate });
    }

    if (atRisk.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const alreadyFired = await this.prisma.alertFired.findFirst({
      where: { ruleId, firedAt: { gte: today } },
    });
    if (alreadyFired) return 0;

    await this.prisma.alertFired.create({
      data: { ruleId, entityType: 'school', entityId: schoolId, meta: { count: atRisk.length } },
    });

    await this.notifyRoleUsers(schoolId, roles, {
      subject: `⚠ ${atRisk.length} curso${atRisk.length !== 1 ? 's' : ''} bajo ${(threshold * 100).toFixed(0)}% — ${schoolName}`,
      body:
        `Cursos con asistencia por debajo del umbral:\n\n` +
        atRisk.map((c) => `• ${c.code} — ${c.name}: ${(c.rate * 100).toFixed(1)}%`).join('\n'),
    });

    return 1;
  }

  private async checkConsecutiveAbsences(
    ruleId: string,
    schoolId: string,
    schoolName: string,
    from: Date,
    to: Date,
    minStreak: number,
    roles: string[],
  ): Promise<number> {
    const [recordsRaw, nonSchool] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { student: { schoolId, active: true }, date: { gte: from, lte: to } },
        orderBy: [{ studentId: 'asc' }, { date: 'asc' }],
        select: {
          studentId: true,
          date: true,
          status: true,
          student: { select: { firstName: true, lastName: true } },
        },
      }),
      this.calendar.getNonSchoolDays(schoolId, from, to),
    ]);
    const records = this.filterSchoolRecords(recordsRaw, nonSchool);

    const byStudent = new Map<string, { name: string; dates: Array<{ absent: boolean }> }>();
    for (const r of records) {
      const name = `${r.student.firstName} ${r.student.lastName}`;
      const e = byStudent.get(r.studentId) ?? { name, dates: [] };
      e.dates.push({ absent: !countsAsAttendance(r.status) });
      byStudent.set(r.studentId, e);
    }

    const streaks: Array<{ id: string; name: string; length: number }> = [];
    for (const [id, data] of byStudent) {
      let max = 0;
      let cur = 0;
      for (const d of data.dates) {
        cur = d.absent ? cur + 1 : 0;
        if (cur > max) max = cur;
      }
      if (max >= minStreak) streaks.push({ id, name: data.name, length: max });
    }

    if (streaks.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const alreadyFired = await this.prisma.alertFired.findFirst({
      where: { ruleId, firedAt: { gte: today } },
    });
    if (alreadyFired) return 0;

    await this.prisma.alertFired.create({
      data: { ruleId, entityType: 'school', entityId: schoolId, meta: { count: streaks.length } },
    });

    await this.notifyRoleUsers(schoolId, roles, {
      subject: `⚠ Rachas de ausencia — ${schoolName}`,
      body:
        `Alumnos con ${minStreak}+ días consecutivos de ausencia:\n\n` +
        streaks
          .slice(0, 20)
          .map((s) => `• ${s.name}: ${s.length} días seguidos`)
          .join('\n'),
    });

    return 1;
  }

  private async checkTeacherNoRecord(
    ruleId: string,
    schoolId: string,
    schoolName: string,
    maxDays: number,
    roles: string[],
  ): Promise<number> {
    const cutoff = new Date(Date.now() - maxDays * 86_400_000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const courseTeachers = await this.prisma.courseTeacher.findMany({
      where: { course: { schoolId, active: true } },
      select: {
        course: { select: { id: true, code: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const lagging: Array<{ teacher: string; course: string }> = [];
    for (const ct of courseTeachers) {
      const latest = await this.prisma.attendanceRecord.findFirst({
        where: { courseId: ct.course.id, recordedById: ct.user.id },
        orderBy: { date: 'desc' },
        select: { date: true },
      });
      if (!latest || latest.date < cutoff) {
        lagging.push({
          teacher: `${ct.user.firstName} ${ct.user.lastName}`,
          course: ct.course.code,
        });
      }
    }

    if (lagging.length === 0) return 0;

    const alreadyFired = await this.prisma.alertFired.findFirst({
      where: { ruleId, firedAt: { gte: today } },
    });
    if (alreadyFired) return 0;

    await this.prisma.alertFired.create({
      data: { ruleId, entityType: 'school', entityId: schoolId, meta: { count: lagging.length } },
    });

    await this.notifyRoleUsers(schoolId, roles, {
      subject: `⚠ Profesores sin registro de asistencia — ${schoolName}`,
      body:
        `Los siguientes profesores no han registrado asistencia en ${maxDays}+ días:\n\n` +
        lagging
          .slice(0, 20)
          .map((l) => `• ${l.teacher} (${l.course})`)
          .join('\n'),
    });

    return 1;
  }

  private filterSchoolRecords<T extends { date: Date }>(
    records: T[],
    nonSchoolDays: Set<string>,
  ): T[] {
    return records.filter(
      (record) => !nonSchoolDays.has(this.schoolConfig.formatDate(record.date)),
    );
  }

  private startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  private async notifyRoleUsers(
    schoolId: string,
    roles: string[],
    msg: { subject: string; body: string },
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        schoolRoles: { some: { schoolId, role: { in: roles as never[] } } },
      },
      select: { email: true, firstName: true, lastName: true },
    });

    for (const u of users) {
      await this.mail
        .sendSystemAlert({
          to: u.email,
          name: `${u.firstName} ${u.lastName}`,
          subject: msg.subject,
          body: msg.body,
          schoolId,
        })
        .catch((e) => this.log.warn(`Alert email to ${u.email} failed: ${(e as Error).message}`));
    }
  }
}
