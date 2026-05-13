import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, SystemRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStudentDto } from './dto/create-student.dto.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { isValidRut, normalizeRut } from './rut.js';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.create({
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
          studentId: student.id,
          schoolId: student.schoolId,
          courseId: student.courseId,
          status: eventStatus,
          effectiveDate,
          reason: eventReason,
          recordedById: actor.sub,
        },
      });
      return student;
    });
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
      }
    > = [];
    const toReactivate: Array<
      (typeof dto.rows)[number] & {
        id: string;
        rut: string;
        parsedBirthDate: Date | null;
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
      seenRuts.add(rut);
      seenNums.add(row.enrollmentNumber);
      if (inactive) {
        toReactivate.push({ ...row, id: inactive.id, rut, parsedBirthDate });
        return;
      }
      toCreate.push({
        ...row,
        rut,
        schoolId: dto.schoolId,
        courseId: dto.courseId,
        parsedBirthDate,
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
                      enrolledAt: this.startOfDay(new Date()),
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
                enrolledAt: this.startOfDay(new Date()),
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
            effectiveDate: this.startOfDay(new Date()),
            reason: 'Importación masiva',
            recordedById: actor.sub,
          })),
          ...reactivatedStudents.map((student) => ({
            studentId: student.id,
            schoolId: student.schoolId,
            courseId: student.courseId,
            status: EnrollmentStatus.RE_ENROLLED,
            effectiveDate: this.startOfDay(new Date()),
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

    const eventStatus = isTransfer ? EnrollmentStatus.TRANSFERRED_OUT : EnrollmentStatus.WITHDRAWN;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({
        where: { id },
        data: { active: false, withdrawnAt: effectiveDate },
      });
      await tx.enrollmentEvent.create({
        data: {
          studentId: id,
          schoolId: student.schoolId,
          courseId: student.courseId,
          status: eventStatus,
          effectiveDate,
          reason: dto.reason?.trim() || null,
          transferredToSchool: isTransfer ? dto.transferredToSchool!.trim() : null,
          recordedById: actor.sub,
        },
      });
      return updated;
    });
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

    return this.prisma.$transaction(async (tx) => {
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
      await tx.enrollmentEvent.create({
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
      return updated;
    });
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

  async getMovements(schoolId: string, from: Date, to: Date, actor: JwtPayload) {
    if (!actor.roles.includes(SystemRole.SUPER_ADMIN) && !this.isSchoolAdmin(actor, schoolId)) {
      throw new ForbiddenException('Sin acceso');
    }
    return this.prisma.enrollmentEvent.findMany({
      where: {
        schoolId,
        effectiveDate: { gte: from, lte: to },
      },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, rut: true },
        },
        recordedBy: {
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
