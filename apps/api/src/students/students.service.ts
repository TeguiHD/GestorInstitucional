import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, EnrollmentStatus, SystemRole, WithdrawalReason } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateStudentDto } from './dto/create-student.dto.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { isValidRut, normalizeRut } from './rut.js';

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findByCourse(courseId: string, date?: string) {
    const attendanceDate = date ? this.parseDateOnly(date) : undefined;
    return this.prisma.student.findMany({
      where: {
        courseId,
        ...(attendanceDate
          ? this.activeOnDateWhere(attendanceDate)
          : { active: true, firstName: { not: '[Eliminado]' } }),
      },
      orderBy: [{ enrollmentNumber: 'asc' }],
    });
  }

  async findByGuardian(guardianId: string) {
    const links = await this.prisma.guardianship.findMany({
      where: { guardianId },
      include: {
        student: {
          include: {
            course: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: { isPrimary: 'desc' },
    });
    return links.map((l) => ({
      ...l.student,
      relation: l.relation,
      isPrimary: l.isPrimary,
    }));
  }

  async findById(id: string) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Alumno no encontrado');
    return student;
  }

  async create(dto: CreateStudentDto, actor: JwtPayload) {
    await this.assertCanAccessCourse(dto.courseId, actor);
    const rut = normalizeRut(dto.rut);
    if (!isValidRut(rut)) throw new BadRequestException('RUT inválido');
    const exists = await this.prisma.student.findUnique({
      where: { schoolId_rut: { schoolId: dto.schoolId, rut } },
    });
    if (exists) {
      if (!exists.active) throw new ConflictException('RUT retirado: usa reingreso');
      throw new ConflictException('RUT ya registrado en este colegio');
    }

    // P1: enrollmentNumber must always be MAX+1 — MINEDUC requires immutable, sequential list numbers
    const enrollmentNumber =
      dto.enrollmentNumber ?? (await this.nextEnrollmentNumber(dto.courseId));

    // Verify the number isn't already taken (in case caller supplied it)
    if (dto.enrollmentNumber) {
      const taken = await this.prisma.student.findUnique({
        where: { courseId_enrollmentNumber: { courseId: dto.courseId, enrollmentNumber } },
      });
      if (taken && taken.rut !== rut)
        throw new ConflictException(`N° lista ${enrollmentNumber} ya está ocupado`);
    }

    const effectiveDate = dto.effectiveDate
      ? this.startOfDay(new Date(`${dto.effectiveDate}T00:00:00.000Z`))
      : this.startOfDay(new Date());

    const isTransfer = !!dto.transferOriginSchool?.trim();
    const eventStatus = isTransfer ? EnrollmentStatus.TRANSFERRED_IN : EnrollmentStatus.ACTIVE;
    const eventReason = isTransfer
      ? `Traslado desde: ${dto.transferOriginSchool!.trim()}`
      : 'Matrícula inicial';

    const student = await this.prisma.$transaction(async (tx) => {
      const created = await tx.student.create({
        data: {
          schoolId: dto.schoolId,
          courseId: dto.courseId,
          rut,
          firstName: dto.firstName,
          lastName: dto.lastName,
          secondLastName: dto.secondLastName ?? null,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          enrollmentNumber,
          enrolledAt: effectiveDate,
        },
      });
      await tx.enrollmentEvent.create({
        data: {
          studentId: created.id,
          schoolId: created.schoolId,
          courseId: created.courseId,
          status: eventStatus,
          effectiveDate,
          reason: eventReason,
          recordedById: actor.sub,
        },
      });
      return created;
    });
    await this.audit.log({
      userId: actor.sub,
      action: AuditAction.CREATE,
      entity: 'Student',
      entityId: student.id,
      meta: { rut, courseId: dto.courseId, isTransfer, eventStatus },
    });
    return student;
  }

  async getAllBySchool(schoolId: string, actor: JwtPayload) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN) && !this.isSchoolAdmin(actor, schoolId)) {
      throw new ForbiddenException('Sin acceso');
    }
    return this.prisma.student.findMany({
      where: { schoolId, active: true, firstName: { not: '[Eliminado]' } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        rut: true,
        enrollmentNumber: true,
        enrolledAt: true,
        course: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ course: { code: 'asc' } }, { enrollmentNumber: 'asc' }],
    });
  }

  /** Bulk import. Skips existing RUTs and duplicate enrollment numbers. Returns per-row result. */
  async importBulk(
    dto: {
      schoolId: string;
      courseId: string;
      rows: Array<{
        rut: string;
        firstName: string;
        lastName: string;
        secondLastName?: string;
        birthDate?: string;
        enrolledAt?: string;
        enrollmentNumber: number;
      }>;
    },
    actor: JwtPayload,
  ) {
    await this.assertCanAccessCourse(dto.courseId, actor);
    const course = await this.prisma.course.findFirst({
      where: { id: dto.courseId, schoolId: dto.schoolId },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('Curso no pertenece al colegio');

    const normalizedInputRuts = dto.rows.map((r) => normalizeRut(r.rut));
    const existing = await this.prisma.student.findMany({
      where: { schoolId: dto.schoolId, rut: { in: normalizedInputRuts } },
      select: { id: true, rut: true, active: true },
    });
    const activeExistingRuts = new Set(existing.filter((e) => e.active).map((e) => e.rut));
    const inactiveByRut = new Map(existing.filter((e) => !e.active).map((e) => [e.rut, e]));

    const usedNums = await this.prisma.student.findMany({
      where: { courseId: dto.courseId },
      select: { id: true, enrollmentNumber: true, active: true },
    });
    const takenNums = new Set(usedNums.map((s) => s.enrollmentNumber));

    const errors: Array<{ row: number; rut: string; reason: string }> = [];
    const toCreate: Array<
      (typeof dto.rows)[number] & {
        schoolId: string;
        courseId: string;
        parsedBirthDate: Date | null;
        parsedEnrolledAt: Date;
      }
    > = [];
    const toReactivate: Array<
      (typeof dto.rows)[number] & {
        id: string;
        rut: string;
        parsedBirthDate: Date | null;
        parsedEnrolledAt: Date;
      }
    > = [];
    const seenRuts = new Set<string>();
    const seenNums = new Set<number>();

    const today = new Date();
    dto.rows.forEach((row, i) => {
      const rut = normalizeRut(row.rut);
      if (!isValidRut(rut)) {
        errors.push({ row: i + 1, rut, reason: 'RUT inválido' });
        return;
      }
      if (seenRuts.has(rut)) {
        errors.push({ row: i + 1, rut, reason: 'RUT duplicado en archivo' });
        return;
      }
      if (activeExistingRuts.has(rut)) {
        errors.push({ row: i + 1, rut, reason: 'RUT ya matriculado' });
        return;
      }
      const inactive = inactiveByRut.get(rut);
      const numberTakenByOther =
        usedNums.some(
          (s) => s.enrollmentNumber === row.enrollmentNumber && s.id !== inactive?.id,
        ) || seenNums.has(row.enrollmentNumber);
      if ((!inactive && takenNums.has(row.enrollmentNumber)) || numberTakenByOther) {
        errors.push({
          row: i + 1,
          rut,
          reason: `N° lista ${row.enrollmentNumber} ocupado`,
        });
        return;
      }
      let parsedBirthDate: Date | null = null;
      if (row.birthDate) {
        const bd = new Date(row.birthDate);
        if (isNaN(bd.getTime())) {
          errors.push({ row: i + 1, rut, reason: 'Fecha de nacimiento inválida' });
          return;
        }
        const ageYears = today.getFullYear() - bd.getFullYear();
        if (bd > today || ageYears < 3 || ageYears > 30) {
          errors.push({
            row: i + 1,
            rut,
            reason: 'Fecha de nacimiento fuera de rango (3–30 años)',
          });
          return;
        }
        parsedBirthDate = bd;
      }
      let parsedEnrolledAt: Date;
      if (row.enrolledAt) {
        const e = new Date(`${row.enrolledAt}T00:00:00.000Z`);
        if (isNaN(e.getTime())) {
          errors.push({ row: i + 1, rut, reason: 'Fecha de ingreso inválida' });
          return;
        }
        parsedEnrolledAt = this.startOfDay(e);
      } else {
        parsedEnrolledAt = this.startOfDay(new Date());
      }
      seenRuts.add(rut);
      seenNums.add(row.enrollmentNumber);
      if (inactive) {
        toReactivate.push({ ...row, id: inactive.id, rut, parsedBirthDate, parsedEnrolledAt });
        return;
      }
      toCreate.push({
        ...row,
        rut,
        schoolId: dto.schoolId,
        courseId: dto.courseId,
        parsedBirthDate,
        parsedEnrolledAt,
      });
    });

    let created = 0;
    let reactivated = 0;
    if (toCreate.length > 0 || toReactivate.length > 0) {
      const result = await this.prisma.$transaction(async (tx) => {
        // Re-check inside transaction to prevent race condition
        const stillExisting = await tx.student.findMany({
          where: { schoolId: dto.schoolId, rut: { in: toCreate.map((r) => r.rut) } },
          select: { rut: true },
        });
        const stillExistingRuts = new Set(stillExisting.map((e) => e.rut));
        const safe = toCreate.filter((r) => !stillExistingRuts.has(r.rut));
        const createdStudents =
          safe.length === 0
            ? []
            : await Promise.all(
                safe.map((r) =>
                  tx.student.create({
                    data: {
                      schoolId: r.schoolId,
                      courseId: r.courseId,
                      rut: r.rut,
                      firstName: r.firstName.trim(),
                      lastName: r.lastName.trim(),
                      secondLastName: r.secondLastName?.trim() ?? null,
                      birthDate: r.parsedBirthDate,
                      enrollmentNumber: r.enrollmentNumber,
                      enrolledAt: r.parsedEnrolledAt,
                    },
                  }),
                ),
              );
        const reactivatedStudents = await Promise.all(
          toReactivate.map((r) =>
            tx.student.update({
              where: { id: r.id },
              data: {
                courseId: dto.courseId,
                firstName: r.firstName.trim(),
                lastName: r.lastName.trim(),
                secondLastName: r.secondLastName?.trim() ?? null,
                birthDate: r.parsedBirthDate,
                enrollmentNumber: r.enrollmentNumber,
                active: true,
                withdrawnAt: null,
                enrolledAt: r.parsedEnrolledAt,
              },
            }),
          ),
        );
        const events = [
          ...createdStudents.map((student) => ({
            studentId: student.id,
            schoolId: student.schoolId,
            courseId: student.courseId,
            status: EnrollmentStatus.ACTIVE,
            effectiveDate: student.enrolledAt,
            reason: 'Importación masiva',
            recordedById: actor.sub,
          })),
          ...reactivatedStudents.map((student) => ({
            studentId: student.id,
            schoolId: student.schoolId,
            courseId: student.courseId,
            status: EnrollmentStatus.RE_ENROLLED,
            effectiveDate: student.enrolledAt,
            reason: 'Reingreso por importación masiva',
            recordedById: actor.sub,
          })),
        ];
        if (events.length > 0) await tx.enrollmentEvent.createMany({ data: events });
        return { created: createdStudents.length, reactivated: reactivatedStudents.length };
      });
      created = result.created;
      reactivated = result.reactivated;
    }

    return { total: dto.rows.length, created, reactivated, skipped: errors.length, errors };
  }

  async withdraw(
    id: string,
    actor: JwtPayload,
    dto: {
      effectiveDate?: string;
      reason?: string;
      transferType?: 'WITHDRAWN' | 'TRANSFERRED_OUT';
      transferredToSchool?: string;
      withdrawalReason?: WithdrawalReason;
    } = {},
  ) {
    await this.assertCanAccessStudent(id, actor);
    const effectiveDate = this.parseDateOnly(dto.effectiveDate);
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Alumno no encontrado');
    if (!student.active) throw new BadRequestException('El alumno ya está retirado');

    const isTransfer = dto.transferType === 'TRANSFERRED_OUT';
    if (isTransfer && !dto.transferredToSchool?.trim()) {
      throw new BadRequestException('Debe indicar el establecimiento destino para un traslado');
    }
    if (!dto.withdrawalReason) {
      throw new BadRequestException('Debe indicar la causal de retiro (normativa SIGE)');
    }
    if (dto.withdrawalReason === WithdrawalReason.OTRO && !dto.reason?.trim()) {
      throw new BadRequestException('Si la causal es "Otro", debe describir el motivo');
    }

    const eventStatus = isTransfer ? EnrollmentStatus.TRANSFERRED_OUT : EnrollmentStatus.WITHDRAWN;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({
        where: { id },
        data: { active: false, withdrawnAt: effectiveDate },
      });
      const event = await tx.enrollmentEvent.create({
        data: {
          studentId: id,
          schoolId: student.schoolId,
          courseId: student.courseId,
          status: eventStatus,
          effectiveDate,
          reason: dto.reason?.trim() || null,
          withdrawalReason: dto.withdrawalReason!,
          transferredToSchool: isTransfer ? dto.transferredToSchool!.trim() : null,
          recordedById: actor.sub,
        },
      });
      return { updated, eventId: event.id };
    });
    await this.audit.log({
      userId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'Student',
      entityId: id,
      meta: {
        op: 'withdraw',
        before: { active: true, withdrawnAt: student.withdrawnAt },
        after: { active: false, withdrawnAt: effectiveDate },
        eventId: result.eventId,
        eventStatus,
        withdrawalReason: dto.withdrawalReason,
        transferredToSchool: dto.transferredToSchool ?? null,
      },
    });
    return result.updated;
  }

  // ── Edit / Void: corrige fecha de movimientos ya registrados (normativa SIGE) ──

  private static ENTRY_STATUSES: EnrollmentStatus[] = [
    EnrollmentStatus.ACTIVE,
    EnrollmentStatus.TRANSFERRED_IN,
    EnrollmentStatus.RE_ENROLLED,
  ];

  private static EXIT_STATUSES: EnrollmentStatus[] = [
    EnrollmentStatus.WITHDRAWN,
    EnrollmentStatus.TRANSFERRED_OUT,
    EnrollmentStatus.GRADUATED,
  ];

  private assertCurrentSchoolYear(date: Date): void {
    if (date.getUTCFullYear() !== new Date().getUTCFullYear()) {
      throw new BadRequestException(
        'Solo se pueden editar movimientos del año lectivo en curso (rectificación de años cerrados vía DEPROV)',
      );
    }
  }

  private async assertAttendanceFits(
    studentId: string,
    enrolledAt: Date,
    withdrawnAt: Date | null,
  ): Promise<void> {
    const out = await this.prisma.attendanceRecord.findFirst({
      where: {
        studentId,
        OR: [{ date: { lt: enrolledAt } }, ...(withdrawnAt ? [{ date: { gt: withdrawnAt } }] : [])],
      },
      select: { date: true },
      orderBy: { date: 'asc' },
    });
    if (out) {
      const iso = out.date.toISOString().slice(0, 10);
      throw new BadRequestException(
        `Existe asistencia registrada el ${iso} fuera del nuevo rango de matrícula. Elimina o ajusta esos registros primero.`,
      );
    }
  }

  async editEnrolledAt(id: string, enrolledAt: string, actor: JwtPayload) {
    await this.assertCanAccessStudent(id, actor);
    if (
      !actor.roles.includes(SystemRole.SUPER_ADMIN) &&
      !actor.roles.includes(SystemRole.DIRECTOR) &&
      !actor.roles.includes(SystemRole.INSPECTORIA)
    ) {
      throw new ForbiddenException('Solo DIRECTOR o INSPECTORIA pueden editar fecha de ingreso');
    }
    const newDate = this.parseDateOnly(enrolledAt);
    this.assertCurrentSchoolYear(newDate);

    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Alumno no encontrado');
    if (!student.active) {
      throw new BadRequestException('Solo se puede editar la fecha de ingreso de alumnos activos');
    }
    if (student.withdrawnAt && newDate > student.withdrawnAt) {
      throw new BadRequestException('La fecha de ingreso no puede ser posterior al retiro');
    }

    await this.assertAttendanceFits(id, newDate, student.withdrawnAt);

    // Sync con el último evento de entrada no anulado
    const latestEntry = await this.prisma.enrollmentEvent.findFirst({
      where: {
        studentId: id,
        voidedAt: null,
        status: { in: StudentsService.ENTRY_STATUSES },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });

    const prevEnrolledAt = student.enrolledAt;
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.student.update({
        where: { id },
        data: { enrolledAt: newDate },
      });
      if (latestEntry) {
        await tx.enrollmentEvent.update({
          where: { id: latestEntry.id },
          data: { effectiveDate: newDate },
        });
      }
      return u;
    });
    await this.audit.log({
      userId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'Student',
      entityId: id,
      meta: {
        op: 'edit-enrolled-at',
        before: { enrolledAt: prevEnrolledAt },
        after: { enrolledAt: newDate },
        syncedEventId: latestEntry?.id ?? null,
      },
    });
    return updated;
  }

  async editMovement(
    eventId: string,
    dto: {
      effectiveDate?: string;
      reason?: string;
      withdrawalReason?: WithdrawalReason;
      transferredToSchool?: string;
    },
    actor: JwtPayload,
  ) {
    if (
      !actor.roles.includes(SystemRole.SUPER_ADMIN) &&
      !actor.roles.includes(SystemRole.DIRECTOR) &&
      !actor.roles.includes(SystemRole.INSPECTORIA)
    ) {
      throw new ForbiddenException('Solo DIRECTOR o INSPECTORIA pueden editar movimientos');
    }

    const event = await this.prisma.enrollmentEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Movimiento no encontrado');
    if (event.voidedAt) throw new BadRequestException('El movimiento está anulado');
    await this.assertCanAccessStudent(event.studentId, actor);

    this.assertCurrentSchoolYear(event.effectiveDate);

    const newDate = dto.effectiveDate ? this.parseDateOnly(dto.effectiveDate) : event.effectiveDate;
    if (dto.effectiveDate) this.assertCurrentSchoolYear(newDate);

    const isExit = StudentsService.EXIT_STATUSES.includes(event.status);
    const isEntry = StudentsService.ENTRY_STATUSES.includes(event.status);

    if (isExit && dto.withdrawalReason === WithdrawalReason.OTRO && !dto.reason?.trim()) {
      throw new BadRequestException('Si la causal es "Otro", debe describir el motivo');
    }

    const student = await this.prisma.student.findUnique({ where: { id: event.studentId } });
    if (!student) throw new NotFoundException('Alumno no encontrado');

    // Determinar si este es el último evento del alumno → si lo es, sincroniza Student
    const latestEvent = await this.prisma.enrollmentEvent.findFirst({
      where: { studentId: event.studentId, voidedAt: null },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
    const isLatest = latestEvent?.id === event.id;

    if (isLatest && dto.effectiveDate) {
      const newEnrolledAt = isEntry ? newDate : student.enrolledAt;
      const newWithdrawnAt = isExit ? newDate : student.withdrawnAt;
      if (newEnrolledAt && newWithdrawnAt && newEnrolledAt > newWithdrawnAt) {
        throw new BadRequestException('La fecha de ingreso no puede ser posterior al retiro');
      }
      await this.assertAttendanceFits(event.studentId, newEnrolledAt, newWithdrawnAt);
    }

    const before = {
      effectiveDate: event.effectiveDate,
      reason: event.reason,
      withdrawalReason: event.withdrawalReason,
      transferredToSchool: event.transferredToSchool,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.enrollmentEvent.update({
        where: { id: eventId },
        data: {
          effectiveDate: newDate,
          reason: dto.reason !== undefined ? dto.reason.trim() || null : event.reason,
          withdrawalReason: isExit
            ? (dto.withdrawalReason ?? event.withdrawalReason)
            : event.withdrawalReason,
          transferredToSchool:
            event.status === EnrollmentStatus.TRANSFERRED_OUT &&
            dto.transferredToSchool !== undefined
              ? dto.transferredToSchool.trim() || null
              : event.transferredToSchool,
        },
      });

      if (isLatest && dto.effectiveDate) {
        if (isEntry) {
          await tx.student.update({
            where: { id: event.studentId },
            data: { enrolledAt: newDate },
          });
        } else if (isExit) {
          await tx.student.update({
            where: { id: event.studentId },
            data: { withdrawnAt: newDate },
          });
        }
      }
      return u;
    });
    await this.audit.log({
      userId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'EnrollmentEvent',
      entityId: eventId,
      meta: {
        op: 'edit-movement',
        studentId: event.studentId,
        before,
        after: {
          effectiveDate: updated.effectiveDate,
          reason: updated.reason,
          withdrawalReason: updated.withdrawalReason,
          transferredToSchool: updated.transferredToSchool,
        },
        syncedStudentState:
          isLatest && dto.effectiveDate ? (isEntry ? 'enrolledAt' : 'withdrawnAt') : null,
      },
    });
    return updated;
  }

  async voidMovement(eventId: string, dto: { voidReason: string }, actor: JwtPayload) {
    if (
      !actor.roles.includes(SystemRole.SUPER_ADMIN) &&
      !actor.roles.includes(SystemRole.DIRECTOR) &&
      !actor.roles.includes(SystemRole.INSPECTORIA)
    ) {
      throw new ForbiddenException('Solo DIRECTOR o INSPECTORIA pueden anular movimientos');
    }

    const event = await this.prisma.enrollmentEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Movimiento no encontrado');
    if (event.voidedAt) throw new BadRequestException('El movimiento ya está anulado');
    await this.assertCanAccessStudent(event.studentId, actor);

    this.assertCurrentSchoolYear(event.effectiveDate);

    const laterEvent = await this.prisma.enrollmentEvent.findFirst({
      where: {
        studentId: event.studentId,
        voidedAt: null,
        id: { not: eventId },
        OR: [
          { effectiveDate: { gt: event.effectiveDate } },
          { effectiveDate: event.effectiveDate, createdAt: { gt: event.createdAt } },
        ],
      },
      select: { id: true },
    });
    if (laterEvent) {
      throw new BadRequestException('Anula primero los movimientos posteriores de este alumno');
    }

    // Evento previo (que pasará a ser el "último" tras la anulación)
    const previousEvent = await this.prisma.enrollmentEvent.findFirst({
      where: { studentId: event.studentId, voidedAt: null, id: { not: eventId } },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });

    let newState: { active: boolean; enrolledAt: Date; withdrawnAt: Date | null };
    if (!previousEvent) {
      // Anular el único evento del alumno = anular su matrícula entera. Bloqueado.
      throw new BadRequestException(
        'No se puede anular el único movimiento del alumno (deja al alumno sin matrícula). Usa la papelera si corresponde.',
      );
    } else if (StudentsService.ENTRY_STATUSES.includes(previousEvent.status)) {
      newState = { active: true, enrolledAt: previousEvent.effectiveDate, withdrawnAt: null };
    } else {
      // EXIT: alumno queda retirado a fecha del exit previo
      const lastEntry = await this.prisma.enrollmentEvent.findFirst({
        where: {
          studentId: event.studentId,
          voidedAt: null,
          id: { not: eventId },
          status: { in: StudentsService.ENTRY_STATUSES },
        },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      });
      newState = {
        active: false,
        enrolledAt: lastEntry?.effectiveDate ?? event.effectiveDate,
        withdrawnAt: previousEvent.effectiveDate,
      };
    }

    // Validar que la asistencia existente cabe en el nuevo rango
    await this.assertAttendanceFits(event.studentId, newState.enrolledAt, newState.withdrawnAt);

    await this.prisma.$transaction(async (tx) => {
      await tx.enrollmentEvent.update({
        where: { id: eventId },
        data: {
          voidedAt: new Date(),
          voidedById: actor.sub,
          voidReason: dto.voidReason.trim(),
        },
      });
      await tx.student.update({
        where: { id: event.studentId },
        data: {
          active: newState.active,
          enrolledAt: newState.enrolledAt,
          withdrawnAt: newState.withdrawnAt,
        },
      });
    });
    await this.audit.log({
      userId: actor.sub,
      action: AuditAction.DELETE,
      entity: 'EnrollmentEvent',
      entityId: eventId,
      meta: {
        op: 'void-movement',
        studentId: event.studentId,
        eventStatus: event.status,
        eventEffectiveDate: event.effectiveDate,
        voidReason: dto.voidReason.trim(),
        restoredStudentState: newState,
      },
    });
    return { ok: true };
  }

  async reEnroll(
    id: string,
    actor: JwtPayload,
    dto: { courseId?: string; enrollmentNumber?: number; effectiveDate?: string; reason?: string },
  ) {
    await this.assertCanAccessStudent(id, actor);
    const effectiveDate = this.parseDateOnly(dto.effectiveDate);
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Alumno no encontrado');
    if (student.active) throw new BadRequestException('El alumno ya está activo');
    if (student.firstName === '[Eliminado]' || student.rut.startsWith('P-')) {
      throw new BadRequestException('El alumno fue purgado y no puede reactivarse');
    }

    const courseId = dto.courseId ?? student.courseId;
    // P1: if re-enrolling in a new course, always assign a new number at the end
    // If returning to same course, keep original number unless overridden
    const enrollmentNumber =
      dto.enrollmentNumber ??
      (courseId !== student.courseId
        ? await this.nextEnrollmentNumber(courseId)
        : student.enrollmentNumber);

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, schoolId: student.schoolId, active: true },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('Curso no pertenece al colegio');
    const numberOwner = await this.prisma.student.findUnique({
      where: { courseId_enrollmentNumber: { courseId, enrollmentNumber } },
      select: { id: true, active: true },
    });
    if (numberOwner && numberOwner.id !== id) {
      throw new ConflictException(`N° lista ${enrollmentNumber} ocupado`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({
        where: { id },
        data: {
          courseId,
          enrollmentNumber,
          active: true,
          // P4: do NOT clear withdrawnAt — it records when the student last left.
          // The new enrolledAt is the re-enrollment date; reports use EnrollmentEvent for history.
          withdrawnAt: null, // must null so activeDuringPeriodWhere works correctly for current period
          enrolledAt: effectiveDate,
        },
      });
      const event = await tx.enrollmentEvent.create({
        data: {
          studentId: id,
          schoolId: student.schoolId,
          courseId,
          status: EnrollmentStatus.RE_ENROLLED,
          effectiveDate,
          reason: dto.reason?.trim() || null,
          recordedById: actor.sub,
        },
      });
      return { updated, eventId: event.id };
    });
    await this.audit.log({
      userId: actor.sub,
      action: AuditAction.UPDATE,
      entity: 'Student',
      entityId: id,
      meta: {
        op: 're-enroll',
        before: {
          active: false,
          courseId: student.courseId,
          enrollmentNumber: student.enrollmentNumber,
        },
        after: { active: true, courseId, enrollmentNumber, enrolledAt: effectiveDate },
        eventId: result.eventId,
      },
    });
    return result.updated;
  }

  async enrollmentEvents(id: string, actor: JwtPayload) {
    await this.assertCanAccessStudent(id, actor);
    return this.prisma.enrollmentEvent.findMany({
      where: { studentId: id },
      include: {
        recordedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listGuardians(studentId: string, actor: JwtPayload) {
    await this.assertCanAccessStudent(studentId, actor);
    return this.prisma.guardianship.findMany({
      where: { studentId },
      include: {
        guardian: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { isPrimary: 'desc' },
    });
  }

  async addGuardian(
    studentId: string,
    dto: { guardianId: string; relation?: string; isPrimary?: boolean },
    actor: JwtPayload,
  ) {
    await this.assertCanAccessStudent(studentId, actor);
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Alumno no encontrado');

    if (dto.isPrimary) {
      await this.prisma.guardianship.updateMany({
        where: { studentId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.guardianship.upsert({
      where: { guardianId_studentId: { guardianId: dto.guardianId, studentId } },
      create: {
        guardianId: dto.guardianId,
        studentId,
        relation: dto.relation ?? 'TUTOR',
        isPrimary: dto.isPrimary ?? false,
      },
      update: { relation: dto.relation ?? 'TUTOR', isPrimary: dto.isPrimary ?? false },
    });
  }

  async removeGuardian(studentId: string, guardianId: string, actor: JwtPayload) {
    await this.assertCanAccessStudent(studentId, actor);
    await this.prisma.guardianship.delete({
      where: { guardianId_studentId: { guardianId, studentId } },
    });
  }

  /** Summary stats for a student (total present/absent/late/justified). */
  async getStats(studentId: string, from?: Date, to?: Date) {
    const where = {
      studentId,
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const [total, present, absent, late, justified] = await Promise.all([
      this.prisma.attendanceRecord.count({ where }),
      this.prisma.attendanceRecord.count({ where: { ...where, status: 'PRESENT' } }),
      this.prisma.attendanceRecord.count({ where: { ...where, status: 'ABSENT' } }),
      this.prisma.attendanceRecord.count({ where: { ...where, status: 'LATE' } }),
      this.prisma.attendanceRecord.count({ where: { ...where, status: 'JUSTIFIED' } }),
    ]);

    const attendanceRate = total > 0 ? (present + late) / total : 0;
    return { total, present, absent, late, justified, attendanceRate };
  }

  async findWithdrawn(schoolId: string, actor: JwtPayload) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN) && !this.isSchoolAdmin(actor, schoolId)) {
      throw new ForbiddenException('Sin acceso');
    }
    return this.prisma.student.findMany({
      where: { schoolId, active: false, firstName: { not: '[Eliminado]' } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        rut: true,
        enrollmentNumber: true,
        withdrawnAt: true,
        enrolledAt: true,
        course: { select: { id: true, code: true, name: true } },
      },
      orderBy: { withdrawnAt: 'desc' },
    });
  }

  async getMovements(
    schoolId: string,
    from: Date,
    to: Date,
    actor: JwtPayload,
    includeVoided = false,
  ) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN) && !this.isSchoolAdmin(actor, schoolId)) {
      throw new ForbiddenException('Sin acceso');
    }
    return this.prisma.enrollmentEvent.findMany({
      where: {
        schoolId,
        effectiveDate: { gte: from, lte: to },
        ...(includeVoided ? {} : { voidedAt: null }),
      },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, rut: true },
        },
        recordedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
        voidedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async restore(id: string, actor: JwtPayload) {
    const studentCheck = await this.prisma.student.findUnique({
      where: { id },
      select: { schoolId: true },
    });
    if (!studentCheck) throw new NotFoundException('Alumno no encontrado');
    if (
      !actor.roles.includes(SystemRole.SUPER_ADMIN) &&
      !this.isSchoolAdmin(actor, studentCheck.schoolId)
    ) {
      throw new ForbiddenException('Sin acceso');
    }
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Alumno no encontrado');
    if (student.active) throw new BadRequestException('El alumno ya está activo');
    if (student.firstName === '[Eliminado]' || student.rut.startsWith('P-')) {
      throw new BadRequestException('El alumno fue purgado y no puede reactivarse');
    }
    return this.prisma.student.update({
      where: { id },
      data: { active: true, withdrawnAt: null, enrolledAt: this.startOfDay(new Date()) },
      select: { id: true, firstName: true, lastName: true, rut: true },
    });
  }

  async purge(id: string, actor: JwtPayload) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN))
      throw new ForbiddenException('Solo SUPER_ADMIN');
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Alumno no encontrado');
    const compactId = id.replaceAll('-', '');
    await this.prisma.$transaction([
      this.prisma.student.update({
        where: { id },
        data: {
          rut: `P-${compactId.slice(0, 10)}`,
          firstName: '[Eliminado]',
          lastName: '[Eliminado]',
          secondLastName: null,
          birthDate: null,
          enrollmentNumber: -Number.parseInt(compactId.slice(0, 7), 16),
          active: false,
          withdrawnAt: student.withdrawnAt ?? new Date(),
        },
      }),
      this.prisma.guardianship.deleteMany({ where: { studentId: id } }),
    ]);
    return { ok: true };
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
    if (this.isSchoolAdmin(user, student.schoolId)) return;
    if (user.roles.includes(SystemRole.APODERADO)) {
      if (student.guardianships.some((g) => g.guardianId === user.sub)) return;
    }
    if (user.roles.includes(SystemRole.PROFESOR)) {
      await this.assertCanAccessCourse(student.courseId, user);
      return;
    }
    throw new ForbiddenException('Sin acceso a este alumno');
  }

  async assertCanAccessCourse(courseId: string, user: JwtPayload): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { schoolId: true },
    });
    if (!course) throw new NotFoundException('Curso no encontrado');

    if (user.roles.includes(SystemRole.SUPER_ADMIN)) return;
    if (this.isSchoolAdmin(user, course.schoolId)) return;
    if (user.roles.includes(SystemRole.PROFESOR)) {
      const assigned = await this.prisma.courseTeacher.findUnique({
        where: { courseId_userId: { courseId, userId: user.sub } },
        select: { id: true },
      });
      if (assigned) return;
    }
    throw new ForbiddenException('Sin acceso a este curso');
  }

  private isSchoolAdmin(user: JwtPayload, schoolId: string): boolean {
    if (user.schoolId !== schoolId) return false;
    return [SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA].some((role) =>
      user.roles.includes(role),
    );
  }

  private activeOnDateWhere(date: Date) {
    return {
      enrolledAt: { lte: date },
      firstName: { not: '[Eliminado]' },
      OR: [{ withdrawnAt: null }, { withdrawnAt: { gt: date } }],
    };
  }

  private parseDateOnly(value?: string): Date {
    const raw = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
    if (Number.isNaN(raw.getTime())) throw new BadRequestException('Fecha inválida');
    return this.startOfDay(raw);
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * P1 (MINEDUC): List numbers must be immutable and sequential.
   * New students always go to the END of the class list.
   * NEVER reuse numbers from withdrawn students.
   */
  private async nextEnrollmentNumber(courseId: string): Promise<number> {
    const max = await this.prisma.student.aggregate({
      where: { courseId },
      _max: { enrollmentNumber: true },
    });
    return (max._max.enrollmentNumber ?? 0) + 1;
  }
}
