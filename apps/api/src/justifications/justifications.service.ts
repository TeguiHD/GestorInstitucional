import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { JustificationStatus } from '@prisma/client';

import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');

@Injectable()
export class JustificationsService {
  private readonly log = new Logger(JustificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async upload(params: {
    recordId: string;
    uploadedById: string;
    reason: string;
    file: { filename: string; mimetype: string; stream: NodeJS.ReadableStream };
  }) {
    if (!ALLOWED_MIME.has(params.file.mimetype)) {
      throw new BadRequestException('Tipo de archivo no permitido (PDF/PNG/JPG/WEBP)');
    }
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id: params.recordId },
    });
    if (!record) throw new NotFoundException('Registro de asistencia no encontrado');

    const year = new Date().getFullYear();
    const dir = join(UPLOADS_ROOT, 'justifications', String(year));
    await mkdir(dir, { recursive: true });

    const ext = extname(params.file.filename) || '.bin';
    const safeExt = /^\.(pdf|png|jpe?g|webp)$/i.test(ext) ? ext : '.bin';
    const fileId = randomUUID();
    const filePath = join(dir, `${fileId}${safeExt}`);

    let size = 0;
    const counter = new (await import('node:stream')).PassThrough();
    counter.on('data', (c: Buffer) => {
      size += c.length;
    });
    const out = createWriteStream(filePath);
    await pipeline(params.file.stream, counter, out);

    const created = await this.prisma.attendanceJustification.create({
      data: {
        recordId: params.recordId,
        uploadedById: params.uploadedById,
        fileName: params.file.filename,
        filePath,
        mimeType: params.file.mimetype,
        sizeBytes: size,
        reason: params.reason,
      },
    });

    await this.audit.log({
      userId: params.uploadedById,
      action: 'CREATE',
      entity: 'AttendanceJustification',
      entityId: created.id,
      meta: { recordId: params.recordId, size },
    });

    return created;
  }

  async listByRecord(recordId: string) {
    return this.prisma.attendanceJustification.findMany({
      where: { recordId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true, email: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async listByStudent(studentId: string) {
    return this.prisma.attendanceJustification.findMany({
      where: { record: { studentId } },
      orderBy: { createdAt: 'desc' },
      include: {
        record: { select: { date: true, status: true } },
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async listBySchool(schoolId: string) {
    return this.prisma.attendanceJustification.findMany({
      where: { record: { student: { schoolId } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        record: {
          select: {
            date: true,
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                rut: true,
                course: { select: { code: true, name: true } },
              },
            },
          },
        },
        uploadedBy: { select: { firstName: true, lastName: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async pendingBySchool(schoolId: string) {
    return this.prisma.attendanceJustification.findMany({
      where: { status: 'PENDING', record: { student: { schoolId } } },
      orderBy: { createdAt: 'asc' },
      include: {
        record: {
          select: {
            date: true,
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                rut: true,
                course: { select: { name: true } },
              },
            },
          },
        },
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async review(id: string, reviewerId: string, decision: 'APPROVED' | 'REJECTED', notes?: string) {
    const j = await this.prisma.attendanceJustification.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    if (j.status !== 'PENDING') throw new ForbiddenException('Ya fue revisada');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.attendanceJustification.update({
        where: { id },
        data: {
          status: decision as JustificationStatus,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewNotes: notes ?? null,
        },
      });
      if (decision === 'APPROVED') {
        await tx.attendanceRecord.update({
          where: { id: j.recordId },
          data: { status: 'JUSTIFIED' },
        });
      }
      return result;
    });

    await this.audit.log({
      userId: reviewerId,
      action: 'UPDATE',
      entity: 'AttendanceJustification',
      entityId: id,
      meta: { decision, recordId: j.recordId },
    });

    void this.notifyGuardianResult(id, decision, notes).catch((e) =>
      this.log.warn(`notifyGuardianResult failed: ${(e as Error).message}`),
    );

    return updated;
  }

  private async notifyGuardianResult(
    justificationId: string,
    decision: 'APPROVED' | 'REJECTED',
    notes?: string,
  ) {
    const j = await this.prisma.attendanceJustification.findUnique({
      where: { id: justificationId },
      include: {
        uploadedBy: {
          select: { email: true, firstName: true, lastName: true, status: true, deletedAt: true },
        },
        record: {
          select: {
            date: true,
            student: {
              select: {
                firstName: true,
                lastName: true,
                schoolId: true,
                guardianships: {
                  where: { isPrimary: true },
                  select: {
                    guardian: {
                      select: {
                        email: true,
                        firstName: true,
                        lastName: true,
                        status: true,
                        deletedAt: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!j) return;

    // Prefer uploader (usually the guardian who sent it); fallback primary guardian
    const candidate =
      j.uploadedBy.status === 'ACTIVE' && !j.uploadedBy.deletedAt
        ? { email: j.uploadedBy.email, name: `${j.uploadedBy.firstName} ${j.uploadedBy.lastName}` }
        : j.record.student.guardianships[0]?.guardian &&
            j.record.student.guardianships[0].guardian.status === 'ACTIVE'
          ? {
              email: j.record.student.guardianships[0].guardian.email,
              name: `${j.record.student.guardianships[0].guardian.firstName} ${j.record.student.guardianships[0].guardian.lastName}`,
            }
          : null;
    if (!candidate) return;

    await this.mail.sendJustificationResult({
      justificationId,
      guardianEmail: candidate.email,
      guardianName: candidate.name,
      studentName: `${j.record.student.firstName} ${j.record.student.lastName}`,
      date: j.record.date,
      decision,
      notes,
      schoolId: j.record.student.schoolId,
    });
  }

  async getFile(id: string) {
    const j = await this.prisma.attendanceJustification.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    return j;
  }

  async remove(id: string, userId: string) {
    const j = await this.prisma.attendanceJustification.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    if (j.uploadedById !== userId && j.status !== 'PENDING') {
      throw new ForbiddenException('Solo el autor puede eliminar antes de revisión');
    }
    await this.prisma.attendanceJustification.delete({ where: { id } });
    try {
      await unlink(j.filePath);
    } catch {
      /* file may be gone */
    }
    return { ok: true };
  }
}
