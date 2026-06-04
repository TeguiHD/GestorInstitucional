import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { CoursesService } from '../courses/courses.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly courses: CoursesService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get('course/:courseId/excel')
  @ApiOperation({ summary: 'Exportar asistencia mensual — formato Excel (replica plantilla CSSP)' })
  async getCourseExcel(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYearMonth(year, month);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateCourseExcel(courseId, year, month, user.sub);
    void res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    void res.header(
      'Content-Disposition',
      `attachment; filename="asistencia-${year}-${String(month).padStart(2, '0')}.xlsx"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/pdf')
  @ApiOperation({ summary: 'Exportar informe mensual en PDF formal' })
  async getCoursePdf(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYearMonth(year, month);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateCoursePdf(courseId, year, month, user.sub);
    void res.header('Content-Type', 'application/pdf');
    void res.header(
      'Content-Disposition',
      `attachment; filename="informe-${year}-${String(month).padStart(2, '0')}.pdf"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/monthly-grid-pdf')
  @ApiOperation({ summary: 'PDF mensual estilo MINEDUC — landscape A4 con grilla día×alumno' })
  async getMonthlyGridPdf(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYearMonth(year, month);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateMonthlyGridPdf(
      courseId,
      Number(year),
      Number(month),
      user.sub,
    );
    void res.header('Content-Type', 'application/pdf');
    void res.header(
      'Content-Disposition',
      `attachment; filename="lista-mensual-${year}-${String(month).padStart(2, '0')}.pdf"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/semester-grid-pdf')
  @ApiOperation({ summary: 'PDF semestral MINEDUC — landscape A4 con grilla día×alumno por mes' })
  async getSemesterGridPdf(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('semester', ParseIntPipe) semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    this.assertSemester(semester);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateSemesterGridPdf(courseId, year, semester, user.sub);
    void res.header('Content-Type', 'application/pdf');
    void res.header(
      'Content-Disposition',
      `attachment; filename="lista-semestral-sem${semester}-${year}.pdf"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/annual-grid-pdf')
  @ApiOperation({ summary: 'PDF anual MINEDUC — landscape A4 con grilla día×alumno por mes' })
  async getAnnualGridPdf(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateAnnualGridPdf(courseId, year, user.sub);
    void res.header('Content-Type', 'application/pdf');
    void res.header('Content-Disposition', `attachment; filename="lista-anual-${year}.pdf"`);
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/weekly')
  @ApiOperation({ summary: 'Reporte semanal Excel — weekStart en formato YYYY-MM-DD' })
  async getWeeklyExcel(
    @Param('courseId') courseId: string,
    @Query('weekStart') weekStart: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertIsoDate(weekStart, 'weekStart');
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateWeeklyExcel(courseId, weekStart, user.sub);
    void res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    void res.header('Content-Disposition', `attachment; filename="semana-${weekStart}.xlsx"`);
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/semester')
  @ApiOperation({ summary: 'Reporte semestral Excel (1 o 2) — 6 hojas mensuales + resumen' })
  async getSemesterExcel(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('semester', ParseIntPipe) semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    this.assertSemester(semester);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateSemesterExcel(
      courseId,
      year,
      Number(semester),
      user.sub,
    );
    void res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    void res.header(
      'Content-Disposition',
      `attachment; filename="semestre${semester}-${year}.xlsx"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/annual')
  @ApiOperation({ summary: 'Reporte anual Excel — 12 hojas mensuales + resumen consolidado' })
  async getAnnualExcel(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateAnnualExcel(courseId, year, user.sub);
    void res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    void res.header('Content-Disposition', `attachment; filename="anual-${year}.xlsx"`);
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/annual/pdf')
  @ApiOperation({ summary: 'Informe anual PDF consolidado' })
  async getAnnualPdf(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateAnnualPdf(courseId, year, user.sub);
    void res.header('Content-Type', 'application/pdf');
    void res.header('Content-Disposition', `attachment; filename="anual-${year}.pdf"`);
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('course/:courseId/semester/pdf')
  @ApiOperation({ summary: 'Informe semestral PDF consolidado' })
  async getSemesterPdf(
    @Param('courseId') courseId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('semester', ParseIntPipe) semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    this.assertSemester(semester);
    await this.courses.assertAccess(courseId, user);
    const buffer = await this.reports.generateSemesterPdf(
      courseId,
      year,
      Number(semester),
      user.sub,
    );
    void res.header('Content-Type', 'application/pdf');
    void res.header(
      'Content-Disposition',
      `attachment; filename="semestre${semester}-${year}.pdf"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('student/:studentId/pdf')
  @ApiOperation({
    summary: 'Certificado individual mensual PDF — formato MINEDUC con bloque de firmas',
  })
  async getStudentMonthlyPdf(
    @Param('studentId') studentId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYearMonth(year, month);
    await this.attendance.assertCanAccessStudent(studentId, user);
    const buffer = await this.reports.generateStudentMonthlyPdf(studentId, year, month, user.sub);
    void res.header('Content-Type', 'application/pdf');
    void res.header(
      'Content-Disposition',
      `attachment; filename="certificado-asistencia-${year}-${String(month).padStart(2, '0')}.pdf"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('student/:studentId/semester/pdf')
  @ApiOperation({ summary: 'Certificado individual semestral PDF' })
  async getStudentSemesterPdf(
    @Param('studentId') studentId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('semester', ParseIntPipe) semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    this.assertSemester(semester);
    await this.attendance.assertCanAccessStudent(studentId, user);
    const buffer = await this.reports.generateStudentSemesterPdf(
      studentId,
      year,
      semester,
      user.sub,
    );
    void res.header('Content-Type', 'application/pdf');
    void res.header(
      'Content-Disposition',
      `attachment; filename="certificado-asistencia-sem${semester}-${year}.pdf"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('student/:studentId/annual/pdf')
  @ApiOperation({ summary: 'Certificado individual anual PDF' })
  async getStudentAnnualPdf(
    @Param('studentId') studentId: string,
    @Query('year', ParseIntPipe) year: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    await this.attendance.assertCanAccessStudent(studentId, user);
    const buffer = await this.reports.generateStudentAnnualPdf(studentId, year, user.sub);
    void res.header('Content-Type', 'application/pdf');
    void res.header(
      'Content-Disposition',
      `attachment; filename="certificado-asistencia-anual-${year}.pdf"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('student/:studentId/excel')
  @ApiOperation({ summary: 'Asistencia individual mensual Excel — grilla día×estado + resumen' })
  async getStudentMonthlyExcel(
    @Param('studentId') studentId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYearMonth(year, month);
    await this.attendance.assertCanAccessStudent(studentId, user);
    const buffer = await this.reports.generateStudentMonthlyExcel(studentId, year, month, user.sub);
    void res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    void res.header(
      'Content-Disposition',
      `attachment; filename="asistencia-individual-${year}-${String(month).padStart(2, '0')}.xlsx"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('student/:studentId/semester/excel')
  @ApiOperation({ summary: 'Asistencia individual semestral Excel — hojas mensuales + resumen' })
  async getStudentSemesterExcel(
    @Param('studentId') studentId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('semester', ParseIntPipe) semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    this.assertSemester(semester);
    await this.attendance.assertCanAccessStudent(studentId, user);
    const buffer = await this.reports.generateStudentSemesterExcel(
      studentId,
      year,
      semester,
      user.sub,
    );
    void res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    void res.header(
      'Content-Disposition',
      `attachment; filename="asistencia-individual-sem${semester}-${year}.xlsx"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  @Get('student/:studentId/annual/excel')
  @ApiOperation({ summary: 'Asistencia individual anual Excel — 12 hojas + resumen consolidado' })
  async getStudentAnnualExcel(
    @Param('studentId') studentId: string,
    @Query('year', ParseIntPipe) year: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    this.assertYear(year);
    await this.attendance.assertCanAccessStudent(studentId, user);
    const buffer = await this.reports.generateStudentAnnualExcel(studentId, year, user.sub);
    void res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    void res.header(
      'Content-Disposition',
      `attachment; filename="asistencia-individual-anual-${year}.xlsx"`,
    );
    void res.header('Cache-Control', 'no-store');
    void res.send(buffer);
  }

  private assertYearMonth(year: number, month: number) {
    this.assertYear(year);
    if (month < 1 || month > 12) throw new BadRequestException('month debe estar entre 1 y 12');
  }

  private assertYear(year: number) {
    if (year < 2020 || year > 2100) throw new BadRequestException('year fuera de rango');
  }

  private assertSemester(semester: number) {
    if (semester !== 1 && semester !== 2) {
      throw new BadRequestException('semester debe ser 1 o 2');
    }
  }

  private assertIsoDate(value: string, field: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} debe usar formato YYYY-MM-DD`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${field} no es una fecha válida`);
    }
  }
}
