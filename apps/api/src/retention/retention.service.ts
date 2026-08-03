import { unlink } from 'node:fs/promises';

import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PURGE_CONFIRMATION,
  type PurgeExpectedCountsDto,
  type PurgeRetentionDto,
} from './dto/purge-retention.dto.js';

const RETENTION = {
  attendanceYears: 5,
  justificationYears: 5,
  auditYears: 3,
  mailMonths: 12,
  alertMonths: 12,
  refreshTokenDays: 30,
} as const;

/**
 * Por encima de este volumen la purga se niega a correr.
 *
 * Con la política actual (asistencia de más de 5 años) el CSSP no debería
 * acercarse: un año completo ronda los 35.000 registros de asistencia. Si el
 * número se dispara, es señal de que algo está mal en el cálculo de las fechas
 * de corte, no de que haya llegado el momento de borrar el histórico.
 */
const PURGE_MAX_ROWS = 50_000;

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

  /**
   * Barreras contra el borrado accidental.
   *
   * Lo que se borra aquí —asistencia, justificaciones, cadena de auditoría— son
   * datos de menores con valor legal ante MINEDUC, y no hay forma de deshacerlo.
   * Antes bastaba un POST vacío de cualquier SUPER_ADMIN autenticado.
   */
  private assertPurgeAllowed(dto: PurgeRetentionDto, actual: PurgeExpectedCountsDto) {
    // 1. Apagada salvo activación explícita. Sin esta variable el endpoint no
    //    hace nada, por muy SUPER_ADMIN que sea quien llame.
    if (process.env.RETENTION_PURGE_ENABLED !== 'true') {
      throw new ForbiddenException(
        'La purga de retención está deshabilitada. Se activa con RETENTION_PURGE_ENABLED=true.',
      );
    }

    // 2. Frase literal. Descarta el POST accidental y cualquier automatismo.
    if (dto.confirm !== PURGE_CONFIRMATION) {
      throw new ForbiddenException(
        `Para ejecutar la purga hay que escribir exactamente: ${PURGE_CONFIRMATION}`,
      );
    }

    // 3. Lo que se borrará tiene que ser lo que el operador vio en el preview.
    //    Si algo cambió entremedio, se aborta en vez de borrar a ciegas.
    const difieren = (Object.keys(actual) as (keyof PurgeExpectedCountsDto)[]).filter(
      (k) => actual[k] !== dto.expected[k],
    );
    if (difieren.length > 0) {
      const detalle = difieren
        .map((k) => `${k}: el preview decía ${dto.expected[k]}, ahora hay ${actual[k]}`)
        .join('; ');
      throw new ConflictException(
        `Los datos cambiaron desde el preview, no se purgó nada. ${detalle}`,
      );
    }

    // 4. Tope de seguridad. Un cutoff mal calculado podría arrasar con todo el
    //    histórico; por encima de este volumen se exige revisión manual.
    const total = Object.values(actual).reduce((a, b) => a + b, 0);
    if (total > PURGE_MAX_ROWS) {
      throw new ForbiddenException(
        `La purga afectaría ${total} registros, por encima del tope de seguridad (${PURGE_MAX_ROWS}). ` +
          'Revisa la política de retención antes de continuar.',
      );
    }
  }

  async purge(actor: JwtPayload, dto: PurgeRetentionDto) {
    this.assertSuperAdmin(actor);

    const preview = await this.preview(actor);
    const actual: PurgeExpectedCountsDto = {
      attendance: preview.attendance,
      justifications: preview.justifications,
      audit: preview.audit,
      mail: preview.mail,
      alerts: preview.alerts,
      tokens: preview.tokens,
    };

    this.assertPurgeAllowed(dto, actual);

    // Nada que borrar: se sale antes de abrir transacción o tocar archivos.
    const total = Object.values(actual).reduce((a, b) => a + b, 0);
    if (total === 0) {
      this.log.log(`Purga solicitada por ${actor.sub}: no había nada que borrar.`);
      return { nothingToPurge: true, ...actual };
    }

    this.log.warn(`PURGA DE RETENCIÓN ejecutada por ${actor.sub}: ${JSON.stringify(actual)}`);

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
