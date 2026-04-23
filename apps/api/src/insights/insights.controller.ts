import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { InsightsService } from './insights.service.js';

@ApiTags('insights')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('course/:id')
  @ApiOperation({ summary: 'Insights automáticos de un curso (patrones, riesgos, tendencia)' })
  course(@Param('id') id: string, @Query('year') year: string, @Query('month') month: string) {
    return this.insights.getCourseInsights(id, Number(year), Number(month));
  }

  @Get('school/:id')
  @ApiOperation({ summary: 'Insights automáticos a nivel colegio' })
  school(@Param('id') id: string, @Query('year') year: string, @Query('month') month: string) {
    return this.insights.getSchoolInsights(id, Number(year), Number(month));
  }

  @Get('school/:id/at-risk')
  @ApiOperation({ summary: 'Alumnos bajo 70% de asistencia en el mes actual' })
  atRisk(@Param('id') id: string, @Query('year') year: string, @Query('month') month: string) {
    return this.insights.getAtRiskStudents(id, Number(year), Number(month));
  }

  @Get('school/:id/heatmap')
  @ApiOperation({ summary: 'Heatmap de asistencia por día de semana × curso' })
  heatmap(@Param('id') id: string, @Query('year') year: string, @Query('month') month: string) {
    return this.insights.getWeekdayHeatmap(id, Number(year), Number(month));
  }

  @Get('school/:id/risk-prediction')
  @ApiOperation({ summary: 'Predicción riesgo repitencia últimas 4 semanas' })
  riskPrediction(@Param('id') id: string) {
    return this.insights.getRiskPrediction(id);
  }
}
