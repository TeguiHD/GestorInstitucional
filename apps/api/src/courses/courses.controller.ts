import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
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
  findAll(@Query('schoolId') schoolId: string, @Query('year') year?: number) {
    return this.courses.findAll(schoolId, year);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de curso (alumnos + profesores)' })
  findOne(@Param('id') id: string) {
    return this.courses.findOne(id);
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Crear curso' })
  create(@Body() dto: CreateCourseDto) {
    return this.courses.create(dto);
  }

  @Post(':id/teachers')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Asignar profesor a curso' })
  assignTeacher(
    @Param('id') courseId: string,
    @Body('userId') userId: string,
    @Body('isHead') isHead: boolean,
  ) {
    return this.courses.assignTeacher(courseId, userId, isHead);
  }

  @Delete(':id/teachers/:userId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Quitar profesor de curso' })
  removeTeacher(@Param('id') courseId: string, @Param('userId') userId: string) {
    return this.courses.removeTeacher(courseId, userId);
  }
}
