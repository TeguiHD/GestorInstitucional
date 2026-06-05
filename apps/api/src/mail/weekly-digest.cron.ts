import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceStatus, MailCategory, MailPriority } from '@prisma/client';

import {
  addAttendanceStatus,
  buildAttendanceSummary,
  emptyAttendanceCounts,
} from '../attendance/attendance-calculation.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolConfigService } from '../school-config/school-config.service.js';
import { MailService } from './mail.service.js';

// Every Friday at 18:00 server time
@Injectable()
export class WeeklyDigestCron {
  private readonly log = new Logger(WeeklyDigestCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly calendar: CalendarService,
    private readonly schoolConfig: SchoolConfigService,
  ) {}

  @Cron('0 18 * * 5', { name: 'mail-weekly-digest', timeZone: 'America/Santiago' })
  async run() {
    if (!this.mail.enabled) return;

    const weekEnd = endOfDay(new Date());
    const weekStart = new Date(weekEnd.getTime() - 6 * 86_400_000);
    weekStart.setHours(0, 0, 0, 0);

    const schools = await this.prisma.school.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });
    let total = 0;

    for (const school of schools) {
      // Active guardianships with guardian email
      const guardianships = await this.prisma.guardianship.findMany({
        where: {
          student: { schoolId: school.id, active: true },
          guardian: { status: 'ACTIVE', deletedAt: null },
        },
        select: {
          guardian: { select: { email: true, firstName: true, lastName: true } },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              enrolledAt: true,
              withdrawnAt: true,
              course: { select: { name: true } },
            },
          },
        },
      });
      const nonSchool = await this.calendar.getNonSchoolDays(school.id, weekStart, weekEnd);

      for (const g of guardianships) {
        const records = await this.prisma.attendanceRecord.findMany({
          where: {
            studentId: g.student.id,
            date: { gte: weekStart, lte: weekEnd },
          },
          select: { date: true, status: true },
        });
        if (records.length === 0) continue;

        const counts = emptyAttendanceCounts();
        const absentDates: string[] = [];
        for (const r of records.filter((record) => !nonSchool.has(formatKey(record.date)))) {
          addAttendanceStatus(counts, r.status);
          if (r.status === AttendanceStatus.ABSENT) absentDates.push(formatShort(r.date));
        }
        const totalClasses = this.schoolConfig.countActiveSchoolDaysInRanges(
          g.student,
          [{ from: weekStart, to: weekEnd }],
          nonSchool,
        );
        if (totalClasses === 0) continue;
        const summary = buildAttendanceSummary(counts, totalClasses);
        const stats = {
          present: summary.present,
          absent: summary.absent,
          late: summary.late,
          justified: summary.justified,
          missing: summary.missing,
          total: summary.totalClasses,
          rate: summary.attendanceRate ?? 0,
        };

        const { subject, html, text } = this.mail.templates.weeklyDigest({
          guardianName: `${g.guardian.firstName} ${g.guardian.lastName}`,
          studentName: `${g.student.firstName} ${g.student.lastName}`,
          courseName: g.student.course.name,
          weekStart,
          weekEnd,
          stats,
          absentDates,
          portalUrl: this.mail.webUrl(),
        });

        const weekKey = formatKey(weekStart);
        const result = await this.mail.enqueue({
          to: { email: g.guardian.email, name: `${g.guardian.firstName} ${g.guardian.lastName}` },
          subject,
          html,
          text,
          category: MailCategory.WEEKLY_DIGEST,
          priority: MailPriority.LOW,
          dedupeKey: `digest:${weekKey}:${g.student.id}:${g.guardian.email}`,
          schoolId: school.id,
        });
        if (result.id) total++;
      }
    }

    this.log.log(`weekly digest enqueued: ${total}`);
  }
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function formatShort(d: Date): string {
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
}

function formatKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
