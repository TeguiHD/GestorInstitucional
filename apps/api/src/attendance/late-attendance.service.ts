import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolConfigService } from '../school-config/school-config.service.js';
import { canResolveLate } from './late-roles.js';

export type LateState = 'pending' | 'resolved';
export type LateResolution = 'PRESENT' | 'ABSENT';

/**
 * Bandeja de atrasos de Inspectoría. Un atraso pendiente (status LATE) no cuenta
 * en el % de asistencia hasta que se resuelve a PRESENT o ABSENT; la marca
 * wasLate conserva el conteo de atrasos. Ver
 * docs/superpowers/specs/2026-10-17-atrasos-pendientes-design.md.
 */
@Injectable()
export class LateAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly schoolConfig: SchoolConfigService,
  ) {}

  async list(
    schoolId: string,
    user: JwtPayload,
    opts: { state: LateState; courseId?: string; q?: string; limit?: number; offset?: number },
  ) {
    this.assertCanResolve(user, schoolId);
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const q = opts.q?.trim();

    const where: Prisma.AttendanceRecordWhereInput = {
      course: { schoolId },
      ...(opts.state === 'pending'
        ? { status: 'LATE' }
        : { wasLate: true, status: { not: 'LATE' } }),
      ...(opts.courseId ? { courseId: opts.courseId } : {}),
      ...(q
        ? {
            student: {
              OR: [
                { firstName: { contains: q } },
                { lastName: { contains: q } },
                { secondLastName: { contains: q } },
                { rut: { contains: q.replace(/\./g, '') } },
              ],
            },
          }
        : {}),
    };

    const [records, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({
        where,
        orderBy: [{ date: 'desc' }, { student: { lastName: 'asc' } }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          date: true,
          status: true,
          lateMinutes: true,
          note: true,
          updatedAt: true,
          student: {
            select: { id: true, firstName: true, lastName: true, secondLastName: true, rut: true },
          },
          course: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);

    return {
      items: records.map((r) => ({ ...r, date: this.schoolConfig.formatDate(r.date) })),
      total,
      limit,
      offset,
    };
  }

  /** Resuelve atrasos pendientes en lote: todos o ninguno. No notifica a apoderados. */
  async resolve(user: JwtPayload, input: { recordIds: string[]; status: LateResolution }) {
    if (!canResolveLate(user)) {
      throw new ForbiddenException('Solo Inspectoría o Dirección pueden resolver atrasos');
    }
    const ids = [...new Set(input.recordIds)];

    const records = await this.prisma.attendanceRecord.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        studentId: true,
        courseId: true,
        date: true,
        status: true,
        wasLate: true,
        course: { select: { id: true, code: true, name: true, schoolId: true } },
        student: {
          select: { firstName: true, lastName: true, secondLastName: true, enrollmentNumber: true },
        },
      },
    });

    if (records.length !== ids.length) {
      throw new NotFoundException('Algunos atrasos ya no existen. Recarga la lista.');
    }
    for (const r of records) this.assertCanResolve(user, r.course.schoolId);

    const alreadyResolved = records.filter((r) => r.status !== 'LATE').length;
    if (alreadyResolved > 0) {
      throw new ConflictException(
        `${alreadyResolved} de los atrasos seleccionados ya fue${
          alreadyResolved !== 1 ? 'ron' : ''
        } resuelto${alreadyResolved !== 1 ? 's' : ''} por otra persona. Recarga la lista.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // La condición status = LATE cierra la carrera con otro guardado simultáneo.
      const { count } = await tx.attendanceRecord.updateMany({
        where: { id: { in: ids }, status: 'LATE' },
        data: {
          status: input.status,
          wasLate: true,
          recordedById: user.sub,
          updatedAt: new Date(),
        },
      });
      if (count !== ids.length) {
        throw new ConflictException(
          'Otra persona modificó algunos de estos atrasos mientras se guardaba. Recarga la lista.',
        );
      }
    });

    // Un evento por curso, con el mismo formato que el guardado de la grilla
    // (attendanceChange) para que cuente en el respaldo por cambios.
    const changedAt = new Date().toISOString();
    const byCourse = new Map<string, typeof records>();
    for (const r of records) byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]);
    for (const [courseId, courseRecords] of byCourse) {
      const course = courseRecords[0]!.course;
      await this.audit.log({
        userId: user.sub,
        action: 'UPDATE',
        entity: 'AttendanceRecord',
        entityId: courseId,
        meta: {
          count: courseRecords.length,
          attendanceChange: true,
          lateResolution: true,
          changedAt,
          recordedById: user.sub,
          changes: courseRecords.map((r) => ({
            courseId,
            courseCode: course.code,
            courseName: course.name,
            schoolId: course.schoolId,
            date: this.schoolConfig.formatDate(r.date),
            studentId: r.studentId,
            studentName: [r.student.firstName, r.student.lastName, r.student.secondLastName]
              .filter(Boolean)
              .join(' '),
            enrollmentNumber: r.student.enrollmentNumber,
            previousStatus: 'LATE',
            newStatus: input.status,
            changedFields: ['status'],
          })),
        },
      });
    }

    return { resolved: ids.length };
  }

  private assertCanResolve(user: JwtPayload, schoolId: string) {
    if (!canResolveLate(user)) {
      throw new ForbiddenException('Solo Inspectoría o Dirección pueden resolver atrasos');
    }
    if (!user.roles.includes('SUPER_ADMIN') && user.schoolId !== schoolId) {
      throw new ForbiddenException('No tienes acceso a este colegio');
    }
  }
}
