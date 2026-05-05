import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { CoursesService } from '../courses/courses.service.js';
import { AttendanceService } from './attendance.service.js';
import { RecordAttendanceDto } from './dto/record-attendance.dto.js';

@ApiTags('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly courses: CoursesService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Registrar asistencia diaria de un curso (bulk upsert, idempotente)' })
  async record(@Body() dto: RecordAttendanceDto, @CurrentUser() user: JwtPayload) {
    await this.courses.assertAccess(dto.courseId, user);
    return this.attendance.recordBulk(dto, user.sub);
  }

  @Get('course/:courseId')
  @ApiOperation({ summary: 'Asistencia de un curso en una fecha' })
  async getByCourseDate(
    @Param('courseId') courseId: string,
    @Query('date') date: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.courses.assertAccess(courseId, user);
    return this.attendance.getByCourseDate(courseId, date);
  }

  @Get('course/:courseId/month')
  @ApiOperation({ summary: 'Resumen mensual de asistencia de un curso' })
  async getCourseMonth(
    @Param('courseId') courseId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.courses.assertAccess(courseId, user);
    return this.attendance.getCourseMonthSummary(
      courseId,
      this.parseIntQuery(year, 'year'),
      this.parseIntQuery(month, 'month'),
    );
  }

  @Get('student/:studentId')
  @ApiOperation({ summary: 'Historial de asistencia de un alumno' })
  async getByStudent(
    @Param('studentId') studentId: string,
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.attendance.assertCanAccessStudent(studentId, user);
    return this.attendance.getByStudent(studentId, from, to);
  }

  @Get('school/:schoolId/stats')
  @ApiOperation({ summary: 'Estadísticas globales por curso (dashboard)' })
  getSchoolStats(
    @Param('schoolId') schoolId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: JwtPayload,
  ) {
    this.courses.assertSchoolAdminAccess(schoolId, user);
    return this.attendance.getSchoolStats(schoolId, from, to);
  }

  @Get('course/:courseId/matrix')
  @ApiOperation({ summary: 'Matriz alumno×día del mes — backbone del dashboard Power BI' })
  async getCourseMatrix(
    @Param('courseId') courseId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.courses.assertAccess(courseId, user);
    return this.attendance.getCourseMatrix(
      courseId,
      this.parseIntQuery(year, 'year'),
      this.parseIntQuery(month, 'month'),
    );
  }

  private parseIntQuery(value: string, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new BadRequestException(`${field} debe ser numérico`);
    }
    return parsed;
  }
}
