import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { CoursesService } from './courses.service.js';
import { CreateCourseDto } from './dto/create-course.dto.js';

@ApiTags('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar cursos de un colegio' })
  findAll(
    @Query('schoolId') schoolId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const parsedYear = year ? Number(year) : undefined;
    if (parsedYear !== undefined && !Number.isInteger(parsedYear)) {
      throw new BadRequestException('year debe ser numérico');
    }
    return this.courses.findAll(schoolId, parsedYear, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de curso (alumnos + profesores)' })
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.courses.findOne(id, user);
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Crear curso' })
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: JwtPayload) {
    this.courses.assertSchoolAdminAccess(dto.schoolId, user);
    return this.courses.create(dto);
  }

  @Post(':id/teachers')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Asignar profesor a curso' })
  async assignTeacher(
    @Param('id') courseId: string,
    @Body('userId') userId: string,
    @Body('isHead') isHead: boolean,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.courses.assertAccess(courseId, user);
    return this.courses.assignTeacher(courseId, userId, isHead);
  }

  @Delete(':id/teachers/:userId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Quitar profesor de curso' })
  async removeTeacher(
    @Param('id') courseId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.courses.assertAccess(courseId, user);
    return this.courses.removeTeacher(courseId, userId);
  }
}
