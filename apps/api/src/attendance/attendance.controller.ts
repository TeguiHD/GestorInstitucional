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
    this.assertIsoDate(dto.date, 'date');
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
    this.assertIsoDate(date, 'date');
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
    const parsedYear = this.parseYear(year);
    const parsedMonth = this.parseMonth(month);
    return this.attendance.getCourseMonthSummary(courseId, parsedYear, parsedMonth);
  }

  @Get('student/:studentId')
  @ApiOperation({ summary: 'Historial de asistencia de un alumno' })
  async getByStudent(
    @Param('studentId') studentId: string,
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (from) this.assertIsoDate(from, 'from');
    if (to) this.assertIsoDate(to, 'to');
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
    this.assertIsoDate(from, 'from');
    this.assertIsoDate(to, 'to');
    this.courses.assertSchoolAdminAccess(schoolId, user);
    return this.attendance.getSchoolStats(schoolId, from, to);
  }

  @Get('course/:courseId/daily-trend')
  @ApiOperation({ summary: 'Tendencia diaria de asistencia de un curso (dashboard drill-down)' })
  async getCourseDailyTrend(
    @Param('courseId') courseId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: JwtPayload,
  ) {
    this.assertIsoDate(from, 'from');
    this.assertIsoDate(to, 'to');
    await this.courses.assertAccess(courseId, user);
    return this.attendance.getCourseDailyTrend(courseId, from, to);
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
    const parsedYear = this.parseYear(year);
    const parsedMonth = this.parseMonth(month);
    return this.attendance.getCourseMatrix(courseId, parsedYear, parsedMonth);
  }

  private parseIntQuery(value: string, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new BadRequestException(`${field} debe ser numérico`);
    }
    return parsed;
  }

  private parseMonth(value: string): number {
    const month = this.parseIntQuery(value, 'month');
    if (month < 1 || month > 12) {
      throw new BadRequestException('month debe estar entre 1 y 12');
    }
    return month;
  }

  private parseYear(value: string): number {
    const year = this.parseIntQuery(value, 'year');
    if (year < 2020 || year > 2100) {
      throw new BadRequestException('year fuera de rango');
    }
    return year;
  }

  private assertIsoDate(value: string, field: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} debe usar formato YYYY-MM-DD`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${field} no es una fecha válida`);
    }
  }
}
