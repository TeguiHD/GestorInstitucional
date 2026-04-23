import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
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
  findByCourse(@Query('courseId') courseId: string, @CurrentUser() user: JwtPayload) {
    void this.courses.assertAccess(courseId, user);
    return this.students.findByCourse(courseId);
  }

  @Get('my-children')
  @ApiOperation({ summary: 'Alumnos del apoderado autenticado' })
  myChildren(@CurrentUser() user: JwtPayload) {
    return this.students.findByGuardian(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Alumno por ID' })
  findOne(@Param('id') id: string) {
    return this.students.findById(id);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Código QR del alumno (PNG) para registro rápido de asistencia' })
  async getQr(@Param('id') id: string, @Res() res: FastifyReply) {
    const buf = await this.students.getQrCode(id);
    void res.header('Content-Type', 'image/png');
    void res.header('Content-Disposition', `inline; filename="qr-${id}.png"`);
    void res.header('Cache-Control', 'public, max-age=86400');
    void res.send(buf);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Estadísticas de asistencia individual' })
  getStats(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.students.getStats(
      id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Matricular alumno' })
  create(@Body() dto: CreateStudentDto) {
    return this.students.create(dto);
  }

  @Post('import')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Importar alumnos masivo (desde Excel parseado en cliente)' })
  importBulk(@Body() dto: ImportStudentsDto) {
    return this.students.importBulk(dto);
  }

  @Get(':id/guardians')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Listar apoderados de un alumno' })
  listGuardians(@Param('id') id: string) {
    return this.students.listGuardians(id);
  }

  @Post(':id/guardians')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Vincular apoderado a alumno' })
  addGuardian(@Param('id') id: string, @Body() dto: AddGuardianDto) {
    return this.students.addGuardian(id, dto);
  }

  @Delete(':id/guardians/:guardianId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Desvincular apoderado de alumno' })
  removeGuardian(@Param('id') id: string, @Param('guardianId') guardianId: string) {
    return this.students.removeGuardian(id, guardianId);
  }

  @Delete(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Dar de baja alumno (soft)' })
  withdraw(@Param('id') id: string) {
    return this.students.withdraw(id);
  }
}
