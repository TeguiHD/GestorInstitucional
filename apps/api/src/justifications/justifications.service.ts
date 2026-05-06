import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { JustificationStatus } from '@prisma/client';

import { encryptBuffer, getFileEncKey } from './file-crypto.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const SCHOOL_ADMIN_ROLES = new Set(['SUPER_ADMIN', 'DIRECTOR', 'UTP', 'INSPECTORIA']);

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
    actor: JwtPayload;
    reason: string;
    file: { filename: string; mimetype: string; stream: NodeJS.ReadableStream };
  }) {
    if (!ALLOWED_MIME.has(params.file.mimetype)) {
      throw new BadRequestException('Tipo de archivo no permitido (PDF/PNG/JPG/WEBP)');
    }
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id: params.recordId },
      include: {
        justifications: {
          where: { status: { in: ['PENDING', 'APPROVED'] } },
          select: { id: true },
          take: 1,
        },
        student: {
          select: {
            schoolId: true,
            courseId: true,
            guardianships: { select: { guardianId: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Registro de asistencia no encontrado');
    if (record.status !== 'ABSENT' && record.status !== 'LATE') {
      throw new BadRequestException('Solo se pueden justificar ausencias o atrasos registrados');
    }
    if (record.justifications.length > 0) {
      throw new ConflictException('Este registro ya tiene una justificación activa');
    }
    await this.assertCanAccessStudent(
      params.actor,
      record.student.schoolId,
      record.student.courseId,
      record.student.guardianships.map((g) => g.guardianId),
    );

    const year = new Date().getFullYear();
    const dir = join(UPLOADS_ROOT, 'justifications', String(year));
    await mkdir(dir, { recursive: true });

    const ext = extname(params.file.filename) || '.bin';
    const safeExt = /^\.(pdf|png|jpe?g|webp)$/i.test(ext) ? ext : '.bin';
    const fileId = randomUUID();
    const filePath = join(dir, `${fileId}${safeExt}`);

    let size = 0;
    const hasher = createHash('sha256');
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_FILE_SIZE_BYTES) {
          callback(new BadRequestException('Archivo demasiado grande (máx 8 MB)'));
          return;
        }
        hasher.update(chunk);
        callback(null, chunk);
      },
    });
    const out = createWriteStream(filePath);
    try {
      await pipeline(params.file.stream, counter, out);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    // Cifrar en reposo (AES-256-GCM)
    const encKey = getFileEncKey();
    const plainBuffer = await readFile(filePath);
    const { encrypted, iv: fileIv } = encryptBuffer(plainBuffer, encKey);
    await writeFile(filePath, encrypted);
    const fileHash = hasher.digest('hex');

    const created = await this.prisma.attendanceJustification.create({
      data: {
        recordId: params.recordId,
        uploadedById: params.uploadedById,
        fileName: params.file.filename,
        filePath,
        mimeType: params.file.mimetype,
        sizeBytes: size,
        fileHash,
        fileIv,
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

  async listByRecord(recordId: string, user: JwtPayload) {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        student: {
          select: {
            schoolId: true,
            courseId: true,
            guardianships: { select: { guardianId: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Registro de asistencia no encontrado');
    await this.assertCanAccessStudent(
      user,
      record.student.schoolId,
      record.student.courseId,
      record.student.guardianships.map((g) => g.guardianId),
    );
    return this.prisma.attendanceJustification.findMany({
      where: { recordId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true, email: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async listByStudent(studentId: string, user: JwtPayload) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        schoolId: true,
        courseId: true,
        guardianships: { select: { guardianId: true } },
      },
    });
    if (!student) throw new NotFoundException('Alumno no encontrado');
    await this.assertCanAccessStudent(
      user,
      student.schoolId,
      student.courseId,
      student.guardianships.map((g) => g.guardianId),
    );
    return this.prisma.attendanceJustification.findMany({
      where: { record: { studentId }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        record: { select: { date: true, status: true } },
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async listBySchool(
    schoolId: string,
    user: JwtPayload,
    opts: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; limit?: number; offset?: number } = {},
  ) {
    this.assertCanAccessSchool(user, schoolId);
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where = {
      record: { student: { schoolId } },
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendanceJustification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
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
      }),
      this.prisma.attendanceJustification.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async pendingBySchool(schoolId: string, user: JwtPayload) {
    this.assertCanAccessSchool(user, schoolId);
    return this.prisma.attendanceJustification.findMany({
      where: { status: 'PENDING', record: { student: { schoolId } }, deletedAt: null },
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

  async review(
    id: string,
    reviewer: JwtPayload,
    decision: 'APPROVED' | 'REJECTED',
    notes?: string,
  ) {
    const j = await this.prisma.attendanceJustification.findUnique({
      where: { id, deletedAt: null },
      include: {
        record: { select: { status: true, student: { select: { schoolId: true } } } },
      },
    });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    this.assertCanAccessSchool(reviewer, j.record.student.schoolId);
    if (j.status !== 'PENDING') throw new ForbiddenException('Ya fue revisada');
    if (decision === 'APPROVED' && j.record.status !== 'ABSENT' && j.record.status !== 'LATE') {
      throw new BadRequestException('El registro ya no es justificable');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.attendanceJustification.update({
        where: { id },
        data: {
          status: decision as JustificationStatus,
          reviewedById: reviewer.sub,
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
      userId: reviewer.sub,
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

  async getFile(id: string, user: JwtPayload) {
    const j = await this.prisma.attendanceJustification.findUnique({
      where: { id, deletedAt: null },
      include: {
        record: {
          select: {
            student: {
              select: {
                schoolId: true,
                courseId: true,
                guardianships: { select: { guardianId: true } },
              },
            },
          },
        },
      },
    });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    await this.assertCanAccessStudent(
      user,
      j.record.student.schoolId,
      j.record.student.courseId,
      j.record.student.guardianships.map((g) => g.guardianId),
    );
    return j;
  }

  async generateReceipt(id: string, user: JwtPayload): Promise<Buffer> {
    const j = await this.prisma.attendanceJustification.findUnique({
      where: { id, deletedAt: null },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true, email: true } },
        record: {
          select: {
            date: true,
            student: {
              select: {
                firstName: true,
                lastName: true,
                rut: true,
                schoolId: true,
                courseId: true,
                course: { select: { code: true, name: true } },
                school: { select: { name: true } },
                guardianships: { select: { guardianId: true } },
              },
            },
          },
        },
      },
    });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    await this.assertCanAccessStudent(
      user,
      j.record.student.schoolId,
      j.record.student.courseId,
      j.record.student.guardianships.map((g) => g.guardianId),
    );

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595 - 112; // usable width
      const fmtDate = (d: Date | string) =>
        new Date(typeof d === 'string' ? d + 'T12:00' : d).toLocaleDateString('es-CL', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
      const fmtDateTime = (d: Date) =>
        d.toLocaleString('es-CL', {
          dateStyle: 'long',
          timeStyle: 'medium',
          timeZone: 'America/Santiago',
        });

      // ── Header ──────────────────────────────────────────────────────────────
      doc
        .fontSize(9)
        .fillColor('#6b7280')
        .text(j.record.student.school.name.toUpperCase(), { align: 'center' });

      doc.moveDown(0.3);
      doc
        .fontSize(14)
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .text('COMPROBANTE DE RECEPCIÓN', { align: 'center' });

      doc
        .fontSize(11)
        .fillColor('#374151')
        .text('Firma Electrónica Simple · Ley N° 19.799', { align: 'center' });

      doc.moveDown(0.4);

      // thin separator
      doc
        .moveTo(56, doc.y)
        .lineTo(56 + W, doc.y)
        .strokeColor('#d1d5db')
        .lineWidth(0.5)
        .stroke();

      doc.moveDown(1);

      // ── Data rows ───────────────────────────────────────────────────────────
      const row = (label: string, value: string, mono = false) => {
        const yStart = doc.y;
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#6b7280')
          .text(label.toUpperCase(), 56, yStart, { width: 140 });
        doc
          .font(mono ? 'Courier' : 'Helvetica')
          .fontSize(9)
          .fillColor('#111827')
          .text(value, 200, yStart, { width: W - 144 });
        doc.moveDown(0.7);
      };

      row('ID Justificación', j.id, true);
      row('Fecha de envío', fmtDateTime(j.createdAt));
      row('Alumno', `${j.record.student.lastName}, ${j.record.student.firstName}`);
      row('RUT alumno', j.record.student.rut);
      row('Curso', `${j.record.student.course.code} — ${j.record.student.course.name}`);
      row('Fecha de ausencia', fmtDate(j.record.date));
      row('Motivo declarado', j.reason);
      row(
        'Archivo adjunto',
        `${j.fileName} (${(j.sizeBytes / 1024).toFixed(1)} KB · ${j.mimeType})`,
      );
      row(
        'Remitente',
        `${j.uploadedBy.firstName} ${j.uploadedBy.lastName} <${j.uploadedBy.email}>`,
      );

      doc.moveDown(0.3);
      doc
        .moveTo(56, doc.y)
        .lineTo(56 + W, doc.y)
        .strokeColor('#d1d5db')
        .lineWidth(0.5)
        .stroke();
      doc.moveDown(0.8);

      // ── Hash block ──────────────────────────────────────────────────────────
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#6b7280')
        .text('HUELLA DIGITAL (SHA-256)', 56);
      doc.moveDown(0.3);
      doc
        .font('Courier')
        .fontSize(8.5)
        .fillColor('#111827')
        .text(
          j.fileHash ?? '(no disponible — documento anterior a implementación FES)',
          56,
          doc.y,
          {
            width: W,
            lineGap: 2,
          },
        );

      doc.moveDown(1.2);

      // ── Legal note ──────────────────────────────────────────────────────────
      doc.roundedRect(56, doc.y, W, 56, 4).fillColor('#f9fafb').fill();

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#374151')
        .text(
          'Este comprobante acredita la recepción electrónica del documento adjunto. ' +
            'La huella digital SHA-256 identifica de forma unívoca el archivo tal como fue enviado. ' +
            'Conforme al artículo 2° de la Ley N° 19.799 sobre Documentos Electrónicos, ' +
            'Firma Electrónica y Servicios de Certificación, esta constancia constituye ' +
            'firma electrónica simple al asociar electrónicamente la identidad del remitente al documento.',
          58,
          doc.y + 8,
          { width: W - 4, lineGap: 2 },
        );

      doc.moveDown(3.5);

      // ── Footer ──────────────────────────────────────────────────────────────
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#9ca3af')
        .text(
          `Generado el ${fmtDateTime(new Date())} · Sistema de Gestión de Asistencia Escolar`,
          56,
          doc.y,
          { align: 'center', width: W },
        );

      doc.end();
    });
  }

  async remove(id: string, user: JwtPayload) {
    const j = await this.prisma.attendanceJustification.findUnique({
      where: { id, deletedAt: null },
      include: { record: { select: { student: { select: { schoolId: true } } } } },
    });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    if (j.status !== 'PENDING') {
      throw new ForbiddenException('Solo se pueden eliminar justificaciones pendientes');
    }
    const sameSchoolAdmin = this.canAccessSchool(user, j.record.student.schoolId);
    if (j.uploadedById !== user.sub && !sameSchoolAdmin) {
      throw new ForbiddenException('Solo el autor o personal autorizado puede eliminarla');
    }
    await this.prisma.attendanceJustification.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'DELETE',
      entity: 'AttendanceJustification',
      entityId: id,
      meta: { recordId: j.recordId, softDelete: true },
    });
    return { ok: true };
  }

  async listTrash(schoolId: string, user: JwtPayload) {
    if (!user.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede ver la papelera');
    }
    return this.prisma.attendanceJustification.findMany({
      where: { deletedAt: { not: null }, record: { student: { schoolId } } },
      orderBy: { deletedAt: 'desc' },
      include: {
        record: {
          select: {
            date: true,
            student: {
              select: {
                firstName: true,
                lastName: true,
                rut: true,
                course: { select: { code: true } },
              },
            },
          },
        },
        uploadedBy: { select: { firstName: true, lastName: true, email: true } },
      },
    });
  }

  async restoreJustification(id: string, user: JwtPayload) {
    if (!user.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Solo SUPER_ADMIN');
    const j = await this.prisma.attendanceJustification.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    if (!j.deletedAt) throw new BadRequestException('La justificación no está eliminada');
    await this.prisma.attendanceJustification.update({
      where: { id },
      data: { deletedAt: null },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'UPDATE',
      entity: 'AttendanceJustification',
      entityId: id,
      meta: { restored: true },
    });
    return { ok: true };
  }

  async purgeJustification(id: string, user: JwtPayload) {
    if (!user.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Solo SUPER_ADMIN');
    const j = await this.prisma.attendanceJustification.findUnique({ where: { id } });
    if (!j) throw new NotFoundException('Justificación no encontrada');
    if (j.filePath) {
      try {
        await unlink(j.filePath);
      } catch {
        /* file may already be gone */
      }
    }
    await this.prisma.attendanceJustification.update({
      where: { id },
      data: {
        fileName: '[archivo-eliminado]',
        filePath: '',
        fileHash: null,
        fileIv: null,
        reason: '[eliminado]',
        deletedAt: new Date(),
      },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'DELETE',
      entity: 'AttendanceJustification',
      entityId: id,
      meta: { purged: true, reason: 'GDPR/Ley21719' },
    });
    return { ok: true };
  }

  private assertCanAccessSchool(user: JwtPayload, schoolId: string) {
    if (!this.canAccessSchool(user, schoolId)) {
      throw new ForbiddenException('No tienes acceso a este colegio');
    }
  }

  private canAccessSchool(user: JwtPayload, schoolId: string) {
    if (user.roles.includes('SUPER_ADMIN')) return true;
    return user.schoolId === schoolId && user.roles.some((role) => SCHOOL_ADMIN_ROLES.has(role));
  }

  private async assertCanAccessStudent(
    user: JwtPayload,
    schoolId: string,
    courseId: string,
    guardianIds: string[],
  ) {
    if (this.canAccessSchool(user, schoolId)) return;
    if (user.roles.includes('APODERADO') && guardianIds.includes(user.sub)) return;
    if (user.schoolId === schoolId && user.roles.includes('PROFESOR')) {
      const assigned = await this.prisma.courseTeacher.findUnique({
        where: { courseId_userId: { courseId, userId: user.sub } },
        select: { id: true },
      });
      if (assigned) return;
    }
    throw new ForbiddenException('No tienes acceso a este alumno');
  }
}
