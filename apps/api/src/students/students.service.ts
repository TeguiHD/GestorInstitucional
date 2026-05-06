import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStudentDto } from './dto/create-student.dto.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';
import { isValidRut, normalizeRut } from './rut.js';

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByCourse(courseId: string) {
    return this.prisma.student.findMany({
      where: { courseId, active: true },
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
    if (exists) throw new ConflictException('RUT ya registrado en este colegio');

    return this.prisma.student.create({ data: { ...dto, rut } });
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

    const existing = await this.prisma.student.findMany({
      where: { schoolId: dto.schoolId, rut: { in: dto.rows.map((r) => r.rut) } },
      select: { rut: true },
    });
    const existingRuts = new Set(existing.map((e) => e.rut));

    const usedNums = await this.prisma.student.findMany({
      where: { courseId: dto.courseId, active: true },
      select: { enrollmentNumber: true },
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
      if (existingRuts.has(rut)) {
        errors.push({ row: i + 1, rut, reason: 'RUT ya matriculado' });
        return;
      }
      if (takenNums.has(row.enrollmentNumber) || seenNums.has(row.enrollmentNumber)) {
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
      toCreate.push({
        ...row,
        rut,
        schoolId: dto.schoolId,
        courseId: dto.courseId,
        parsedBirthDate,
      });
    });

    let created = 0;
    if (toCreate.length > 0) {
      const result = await this.prisma.$transaction(async (tx) => {
        // Re-check inside transaction to prevent race condition
        const stillExisting = await tx.student.findMany({
          where: { schoolId: dto.schoolId, rut: { in: toCreate.map((r) => r.rut) } },
          select: { rut: true },
        });
        const stillExistingRuts = new Set(stillExisting.map((e) => e.rut));
        const safe = toCreate.filter((r) => !stillExistingRuts.has(r.rut));
        if (safe.length === 0) return { count: 0 };
        return tx.student.createMany({
          data: safe.map((r) => ({
            schoolId: r.schoolId,
            courseId: r.courseId,
            rut: r.rut,
            firstName: r.firstName.trim(),
            lastName: r.lastName.trim(),
            secondLastName: r.secondLastName?.trim() ?? null,
            birthDate: r.parsedBirthDate,
            enrollmentNumber: r.enrollmentNumber,
          })),
        });
      });
      created = result.count;
    }

    return { total: dto.rows.length, created, skipped: errors.length, errors };
  }

  async withdraw(id: string, actor: JwtPayload) {
    await this.assertCanAccessStudent(id, actor);
    return this.prisma.student.update({
      where: { id },
      data: { active: false, withdrawnAt: new Date() },
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
    return [SystemRole.DIRECTOR, SystemRole.UTP].some((role) => user.roles.includes(role));
  }
}
