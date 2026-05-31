import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendanceStatus, MailCategory, MailPriority } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from './mail.service.js';

// Every Friday at 18:00 server time
@Injectable()
export class WeeklyDigestCron {
  private readonly log = new Logger(WeeklyDigestCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
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
              course: { select: { name: true } },
            },
          },
        },
      });

      for (const g of guardianships) {
        const records = await this.prisma.attendanceRecord.findMany({
          where: {
            studentId: g.student.id,
            date: { gte: weekStart, lte: weekEnd },
          },
          select: { date: true, status: true },
        });
        if (records.length === 0) continue;

        const stats = { present: 0, absent: 0, late: 0, justified: 0, total: records.length };
        const absentDates: string[] = [];
        for (const r of records) {
          if (r.status === AttendanceStatus.PRESENT) stats.present++;
          else if (r.status === AttendanceStatus.ABSENT) {
            stats.absent++;
            absentDates.push(formatShort(r.date));
          } else if (r.status === AttendanceStatus.LATE) stats.late++;
          else if (r.status === AttendanceStatus.JUSTIFIED) stats.justified++;
        }
        const rate =
          stats.total > 0 ? (stats.present + stats.late + stats.justified) / stats.total : 1;

        const { subject, html, text } = this.mail.templates.weeklyDigest({
          guardianName: `${g.guardian.firstName} ${g.guardian.lastName}`,
          studentName: `${g.student.firstName} ${g.student.lastName}`,
          courseName: g.student.course.name,
          weekStart,
          weekEnd,
          stats: { ...stats, rate },
          absentDates,
          portalUrl: this.mail.webUrl(),
        });

        const weekKey = weekStart.toISOString().slice(0, 10);
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
