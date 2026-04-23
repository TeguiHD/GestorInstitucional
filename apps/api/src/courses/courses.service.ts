import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCourseDto } from './dto/create-course.dto.js';
import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(schoolId: string, year?: number) {
    return this.prisma.course.findMany({
      where: { schoolId, active: true, ...(year ? { year } : {}) },
      include: {
        _count: { select: { students: { where: { active: true } } } },
        teachers: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
  }

  async findOne(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        students: { where: { active: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] },
        teachers: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
    });
    if (!course) throw new NotFoundException('Curso no encontrado');
    return course;
  }

  async create(dto: CreateCourseDto) {
    return this.prisma.course.create({ data: dto });
  }

  async assignTeacher(courseId: string, userId: string, isHead = false) {
    return this.prisma.courseTeacher.upsert({
      where: { courseId_userId: { courseId, userId } },
      update: { isHead },
      create: { courseId, userId, isHead },
    });
  }

  async removeTeacher(courseId: string, userId: string) {
    return this.prisma.courseTeacher.delete({
      where: { courseId_userId: { courseId, userId } },
    });
  }

  /** Validates a user can access the course (teacher assigned or admin role). */
  async assertAccess(courseId: string, user: JwtPayload): Promise<void> {
    const isAdmin = [SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP].some((r) =>
      user.roles.includes(r),
    );
    if (isAdmin) return;

    const assigned = await this.prisma.courseTeacher.findUnique({
      where: { courseId_userId: { courseId, userId: user.sub } },
    });
    if (!assigned) throw new ForbiddenException('Sin acceso a este curso');
  }
}
