import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { CoursesService } from '../courses/courses.service.js';
import { InsightsService } from './insights.service.js';

@ApiTags('insights')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly courses: CoursesService,
  ) {}

  @Get('course/:id')
  @ApiOperation({ summary: 'Insights automáticos de un curso (patrones, riesgos, tendencia)' })
  async course(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    await this.courses.assertAccess(id, user);
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2020 || y > 2100)
      throw new BadRequestException('year inválido');
    if (!Number.isInteger(m) || m < 1 || m > 12)
      throw new BadRequestException('month debe estar entre 1 y 12');
    return this.insights.getCourseInsights(id, y, m);
  }

  @Get('school/:id')
  @ApiOperation({ summary: 'Insights automáticos a nivel colegio' })
  school(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    this.courses.assertSchoolAdminAccess(id, user);
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2020 || y > 2100)
      throw new BadRequestException('year inválido');
    if (!Number.isInteger(m) || m < 1 || m > 12)
      throw new BadRequestException('month debe estar entre 1 y 12');
    return this.insights.getSchoolInsights(id, y, m);
  }

  @Get('school/:id/at-risk')
  @ApiOperation({ summary: 'Alumnos bajo 70% de asistencia en el mes actual' })
  atRisk(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    this.courses.assertSchoolAdminAccess(id, user);
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2020 || y > 2100)
      throw new BadRequestException('year inválido');
    if (!Number.isInteger(m) || m < 1 || m > 12)
      throw new BadRequestException('month debe estar entre 1 y 12');
    return this.insights.getAtRiskStudents(id, y, m);
  }

  @Get('school/:id/heatmap')
  @ApiOperation({ summary: 'Heatmap de asistencia por día de semana × curso' })
  heatmap(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    this.courses.assertSchoolAdminAccess(id, user);
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 2020 || y > 2100)
      throw new BadRequestException('year inválido');
    if (!Number.isInteger(m) || m < 1 || m > 12)
      throw new BadRequestException('month debe estar entre 1 y 12');
    return this.insights.getWeekdayHeatmap(id, y, m);
  }

  @Get('school/:id/risk-prediction')
  @ApiOperation({ summary: 'Predicción riesgo repitencia últimas 4 semanas' })
  riskPrediction(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    this.courses.assertSchoolAdminAccess(id, user);
    return this.insights.getRiskPrediction(id);
  }
}
