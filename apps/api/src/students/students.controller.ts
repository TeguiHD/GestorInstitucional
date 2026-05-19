import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SystemRole, WithdrawalReason } from '@prisma/client';

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

class EnrollmentMovementDto {
  @ApiProperty({ required: false, description: 'Fecha efectiva YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiProperty({ required: false, enum: ['WITHDRAWN', 'TRANSFERRED_OUT'] })
  @IsOptional()
  @IsString()
  transferType?: 'WITHDRAWN' | 'TRANSFERRED_OUT';

  @ApiProperty({
    required: false,
    description: 'Establecimiento destino (requerido si transferType=TRANSFERRED_OUT)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  transferredToSchool?: string;

  @ApiProperty({ required: false, enum: WithdrawalReason })
  @IsOptional()
  @IsEnum(WithdrawalReason)
  withdrawalReason?: WithdrawalReason;
}

class EditEnrolledAtDto {
  @ApiProperty({ description: 'Nueva fecha de ingreso YYYY-MM-DD' })
  @IsDateString()
  enrolledAt!: string;
}

class EditMovementDto {
  @ApiProperty({ required: false, description: 'Fecha efectiva YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiProperty({ required: false, enum: WithdrawalReason })
  @IsOptional()
  @IsEnum(WithdrawalReason)
  withdrawalReason?: WithdrawalReason;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  transferredToSchool?: string;
}

class VoidMovementDto {
  @ApiProperty({ description: 'Motivo de anulación (obligatorio)' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  voidReason!: string;
}

class ReEnrollStudentDto extends EnrollmentMovementDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  courseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  enrollmentNumber?: number;
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
  async findByCourse(
    @Query('courseId') courseId: string,
    @CurrentUser() user: JwtPayload,
    @Query('date') date?: string,
  ) {
    await this.courses.assertAccess(courseId, user);
    return this.students.findByCourse(courseId, date);
  }

  @Get('my-children')
  @ApiOperation({ summary: 'Alumnos del apoderado autenticado' })
  myChildren(@CurrentUser() user: JwtPayload) {
    return this.students.findByGuardian(user.sub);
  }

  @Get('trash')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Alumnos retirados del colegio' })
  findWithdrawn(@Query('schoolId') schoolId: string, @CurrentUser() actor: JwtPayload) {
    return this.students.findWithdrawn(schoolId, actor);
  }

  @Get('school-active')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Todos los alumnos activos del colegio' })
  getAllBySchool(@Query('schoolId') schoolId: string, @CurrentUser() actor: JwtPayload) {
    return this.students.getAllBySchool(schoolId, actor);
  }

  @Get('movements')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Movimientos de matrícula del período' })
  getMovements(
    @Query('schoolId') schoolId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() actor: JwtPayload,
    @Query('includeVoided') includeVoided?: string,
  ) {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Fechas inválidas');
    }
    return this.students.getMovements(schoolId, fromDate, toDate, actor, includeVoided === 'true');
  }

  @Patch('movements/:eventId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Editar movimiento de matrícula ya registrado' })
  editMovement(
    @Param('eventId') eventId: string,
    @Body() dto: EditMovementDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.students.editMovement(eventId, dto, actor);
  }

  @Delete('movements/:eventId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Anular (soft delete) movimiento de matrícula' })
  voidMovement(
    @Param('eventId') eventId: string,
    @Body() dto: VoidMovementDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.students.voidMovement(eventId, dto, actor);
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

  @Get(':id/enrollment-events')
  @ApiOperation({ summary: 'Historial de matrícula/retiro del alumno' })
  enrollmentEvents(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.students.enrollmentEvents(id, user);
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Matricular alumno' })
  create(@Body() dto: CreateStudentDto, @CurrentUser() user: JwtPayload) {
    return this.students.create(dto, user);
  }

  @Post('import')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Importar alumnos masivo (desde Excel parseado en cliente)' })
  importBulk(@Body() dto: ImportStudentsDto, @CurrentUser() user: JwtPayload) {
    return this.students.importBulk(dto, user);
  }

  @Get(':id/guardians')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Listar apoderados de un alumno' })
  listGuardians(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.students.listGuardians(id, user);
  }

  @Post(':id/guardians')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Vincular apoderado a alumno' })
  addGuardian(
    @Param('id') id: string,
    @Body() dto: AddGuardianDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.students.addGuardian(id, dto, user);
  }

  @Delete(':id/guardians/:guardianId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Desvincular apoderado de alumno' })
  removeGuardian(
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.students.removeGuardian(id, guardianId, user);
  }

  @Post(':id/restore')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.INSPECTORIA)
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
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Dar de baja alumno (soft)' })
  withdraw(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: EnrollmentMovementDto = {},
  ) {
    return this.students.withdraw(id, user, dto);
  }

  @Post(':id/withdraw')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Dar de baja alumno con fecha efectiva' })
  withdrawWithDate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: EnrollmentMovementDto,
  ) {
    return this.students.withdraw(id, user, dto);
  }

  @Patch(':id/enrolled-at')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Editar fecha de ingreso del alumno activo' })
  editEnrolledAt(
    @Param('id') id: string,
    @Body() dto: EditEnrolledAtDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.students.editEnrolledAt(id, dto.enrolledAt, actor);
  }

  @Post(':id/re-enroll')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Reingresar alumno retirado' })
  reEnroll(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReEnrollStudentDto,
  ) {
    return this.students.reEnroll(id, user, dto);
  }
}
