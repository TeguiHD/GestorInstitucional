import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { CoursesService } from '../courses/courses.service.js';
import { StudentsService } from './students.service.js';
import { CreateStudentDto } from './dto/create-student.dto.js';
import { ImportStudentsDto } from './dto/import-students.dto.js';

class AddGuardianDto {
  @ApiProperty()
  @IsString()
  @MaxLength(36)
  guardianId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  relation?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

@ApiTags('students')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly courses: CoursesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Alumnos por curso' })
  async findByCourse(@Query('courseId') courseId: string, @CurrentUser() user: JwtPayload) {
    await this.courses.assertAccess(courseId, user);
    return this.students.findByCourse(courseId);
  }

  @Get('my-children')
  @ApiOperation({ summary: 'Alumnos del apoderado autenticado' })
  myChildren(@CurrentUser() user: JwtPayload) {
    return this.students.findByGuardian(user.sub);
  }

  @Get('trash')
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Alumnos retirados — papelera (SUPER_ADMIN)' })
  findWithdrawn(@Query('schoolId') schoolId: string, @CurrentUser() actor: JwtPayload) {
    return this.students.findWithdrawn(schoolId, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Alumno por ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.students.assertCanAccessStudent(id, user);
    return this.students.findById(id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Estadísticas de asistencia individual' })
  async getStats(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.students.assertCanAccessStudent(id, user);
    return this.students.getStats(
      id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Matricular alumno' })
  create(@Body() dto: CreateStudentDto, @CurrentUser() user: JwtPayload) {
    return this.students.create(dto, user);
  }

  @Post('import')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Importar alumnos masivo (desde Excel parseado en cliente)' })
  importBulk(@Body() dto: ImportStudentsDto, @CurrentUser() user: JwtPayload) {
    return this.students.importBulk(dto, user);
  }

  @Get(':id/guardians')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Listar apoderados de un alumno' })
  listGuardians(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.students.listGuardians(id, user);
  }

  @Post(':id/guardians')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Vincular apoderado a alumno' })
  addGuardian(
    @Param('id') id: string,
    @Body() dto: AddGuardianDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.students.addGuardian(id, dto, user);
  }

  @Delete(':id/guardians/:guardianId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Desvincular apoderado de alumno' })
  removeGuardian(
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.students.removeGuardian(id, guardianId, user);
  }

  @Post(':id/restore')
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Reactivar alumno retirado' })
  restore(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.students.restore(id, actor);
  }

  @Delete(':id/purge')
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Purgar alumno definitivamente (Ley 21.719)' })
  purge(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.students.purge(id, actor);
  }

  @Delete(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Dar de baja alumno (soft)' })
  withdraw(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.students.withdraw(id, user);
  }
}
