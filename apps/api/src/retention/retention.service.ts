import { unlink } from 'node:fs/promises';

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RETENTION = {
  attendanceYears: 5,
  justificationYears: 5,
  auditYears: 3,
  mailMonths: 12,
  alertMonths: 12,
  refreshTokenDays: 30,
} as const;

@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(actor: JwtPayload) {
    this.assertSuperAdmin(actor);

    const [attendance, justifications, audit, mail, alerts, tokens] = await Promise.all([
      this.prisma.attendanceRecord.count({
        where: { date: { lt: this.cutoff('years', RETENTION.attendanceYears) } },
      }),
      this.prisma.attendanceJustification.count({
        where: { createdAt: { lt: this.cutoff('years', RETENTION.justificationYears) } },
      }),
      this.prisma.auditEvent.count({
        where: { createdAt: { lt: this.cutoff('years', RETENTION.auditYears) } },
      }),
      this.prisma.mailOutbox.count({
        where: { createdAt: { lt: this.cutoff('months', RETENTION.mailMonths) } },
      }),
      this.prisma.alertFired.count({
        where: { firedAt: { lt: this.cutoff('months', RETENTION.alertMonths) } },
      }),
      this.prisma.refreshToken.count({
        where: { expiresAt: { lt: this.cutoff('days', RETENTION.refreshTokenDays) } },
      }),
    ]);

    const oldRecords = await this.prisma.attendanceRecord.findMany({
      where: { date: { lt: this.cutoff('years', RETENTION.attendanceYears) } },
      select: { date: true },
    });
    const yearsNeedingSnapshot = [
      ...new Set(oldRecords.map((record) => record.date.getFullYear())),
    ];
    const existingSnapshots = await this.prisma.retentionSnapshot.findMany({
      where: { year: { in: yearsNeedingSnapshot } },
      select: { year: true },
    });
    const existingYears = new Set(existingSnapshots.map((snapshot) => snapshot.year));
    const snapshotsToGenerate = yearsNeedingSnapshot.filter((year) => !existingYears.has(year));

    return { attendance, justifications, audit, mail, alerts, tokens, snapshotsToGenerate };
  }

  async purge(actor: JwtPayload) {
    this.assertSuperAdmin(actor);

    const attendanceCutoff = this.cutoff('years', RETENTION.attendanceYears);
    const justificationCutoff = this.cutoff('years', RETENTION.justificationYears);

    await this.createAttendanceSnapshots(attendanceCutoff);
    const deletedFiles = await this.deleteExpiredJustificationFiles(justificationCutoff);

    const [
      deletedAttendance,
      deletedJustifications,
      deletedAudit,
      deletedMail,
      deletedAlerts,
      deletedTokens,
    ] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.deleteMany({
        where: { date: { lt: attendanceCutoff } },
      }),
      this.prisma.attendanceJustification.deleteMany({
        where: { createdAt: { lt: justificationCutoff } },
      }),
      this.prisma.auditEvent.deleteMany({
        where: { createdAt: { lt: this.cutoff('years', RETENTION.auditYears) } },
      }),
      this.prisma.mailOutbox.deleteMany({
        where: { createdAt: { lt: this.cutoff('months', RETENTION.mailMonths) } },
      }),
      this.prisma.alertFired.deleteMany({
        where: { firedAt: { lt: this.cutoff('months', RETENTION.alertMonths) } },
      }),
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: this.cutoff('days', RETENTION.refreshTokenDays) } },
      }),
    ]);

    await this.audit.log({
      userId: actor.sub,
      action: 'DELETE',
      entity: 'RetentionPurge',
      entityId: 'system',
      meta: {
        deletedAttendance: deletedAttendance.count,
        deletedJustifications: deletedJustifications.count,
        deletedAudit: deletedAudit.count,
        deletedMail: deletedMail.count,
        deletedAlerts: deletedAlerts.count,
        deletedTokens: deletedTokens.count,
        deletedFiles,
      },
    });

    return {
      deletedAttendance: deletedAttendance.count,
      deletedJustifications: deletedJustifications.count,
      deletedAudit: deletedAudit.count,
      deletedMail: deletedMail.count,
      deletedAlerts: deletedAlerts.count,
      deletedTokens: deletedTokens.count,
      deletedFiles,
    };
  }

  private async createAttendanceSnapshots(attendanceCutoff: Date) {
    const oldYearRecords = await this.prisma.attendanceRecord.findMany({
      where: { date: { lt: attendanceCutoff } },
      select: {
        date: true,
        courseId: true,
        status: true,
        course: { select: { schoolId: true, code: true, name: true } },
      },
    });

    type CourseSummary = {
      id: string;
      code: string;
      name: string;
      total: number;
      present: number;
      absent: number;
      late: number;
      justified: number;
    };
    const bySchoolYear = new Map<string, Map<number, Map<string, CourseSummary>>>();
    for (const record of oldYearRecords) {
      const schoolId = record.course.schoolId;
      const year = record.date.getFullYear();
      const byYear = bySchoolYear.get(schoolId) ?? new Map<number, Map<string, CourseSummary>>();
      bySchoolYear.set(schoolId, byYear);
      const byCourse = byYear.get(year) ?? new Map<string, CourseSummary>();
      byYear.set(year, byCourse);
      const entry = byCourse.get(record.courseId) ?? {
        id: record.courseId,
        code: record.course.code,
        name: record.course.name,
        total: 0,
        present: 0,
        absent: 0,
        late: 0,
        justified: 0,
      };
      entry.total += 1;
      if (record.status === 'PRESENT') entry.present += 1;
      else if (record.status === 'ABSENT') entry.absent += 1;
      else if (record.status === 'LATE') entry.late += 1;
      else if (record.status === 'JUSTIFIED') entry.justified += 1;
      byCourse.set(record.courseId, entry);
    }

    for (const [schoolId, byYear] of bySchoolYear) {
      for (const [year, byCourse] of byYear) {
        await this.prisma.retentionSnapshot.upsert({
          where: { schoolId_year: { schoolId, year } },
          create: {
            schoolId,
            year,
            summary: { courses: Array.from(byCourse.values()) } as Prisma.InputJsonValue,
          },
          update: {},
        });
      }
    }
  }

  private async deleteExpiredJustificationFiles(justificationCutoff: Date) {
    const justifications = await this.prisma.attendanceJustification.findMany({
      where: { createdAt: { lt: justificationCutoff }, filePath: { not: '' } },
      select: { id: true, filePath: true },
    });
    let deletedFiles = 0;
    for (const justification of justifications) {
      try {
        await unlink(justification.filePath);
        deletedFiles += 1;
      } catch (error) {
        this.log.warn(
          `No se pudo eliminar archivo vencido ${justification.id}: ${(error as Error).message}`,
        );
      }
    }
    return deletedFiles;
  }

  private cutoff(unit: 'years' | 'months' | 'days', amount: number): Date {
    const date = new Date();
    if (unit === 'years') date.setFullYear(date.getFullYear() - amount);
    else if (unit === 'months') date.setMonth(date.getMonth() - amount);
    else date.setDate(date.getDate() - amount);
    return date;
  }

  private assertSuperAdmin(actor: JwtPayload) {
    if (!actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Solo SUPER_ADMIN');
  }
}
