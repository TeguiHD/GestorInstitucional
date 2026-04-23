import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('course/:courseId/excel')
  @ApiOperation({ summary: 'Exportar asistencia mensual — formato Excel (replica plantilla CSSP)' })
  async getCourseExcel(
    @Param('courseId') courseId: string,
    @Query('year') year: number,
    @Query('month') month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
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
    @Query('year') year: number,
    @Query('month') month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
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
    @Query('year') year: number,
    @Query('month') month: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
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

  @Get('course/:courseId/weekly')
  @ApiOperation({ summary: 'Reporte semanal Excel — weekStart en formato YYYY-MM-DD' })
  async getWeeklyExcel(
    @Param('courseId') courseId: string,
    @Query('weekStart') weekStart: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
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
    @Query('year') year: number,
    @Query('semester') semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
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

  @Get('course/:courseId/semester/pdf')
  @ApiOperation({ summary: 'Informe semestral PDF consolidado' })
  async getSemesterPdf(
    @Param('courseId') courseId: string,
    @Query('year') year: number,
    @Query('semester') semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
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
}
