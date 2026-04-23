import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertTrigger, SystemRole } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { AlertsService } from './alerts.service.js';

class UpsertAlertRuleDto {
  trigger!: AlertTrigger;
  threshold?: number;
  windowDays?: number;
  enabled?: boolean;
  notifyRoles?: string[];
}

@ApiTags('alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('school/:schoolId/rules')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Listar reglas de alerta del colegio' })
  listRules(@Param('schoolId') schoolId: string) {
    return this.alerts.listRules(schoolId);
  }

  @Put('school/:schoolId/rules')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Crear o actualizar regla de alerta' })
  upsertRule(@Param('schoolId') schoolId: string, @Body() dto: UpsertAlertRuleDto) {
    return this.alerts.upsertRule({ schoolId, ...dto });
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Eliminar regla de alerta' })
  deleteRule(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.alerts.deleteRule(id, user.schoolId);
  }

  @Get('fired/recent')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Últimas alertas disparadas — para badge en header' })
  getRecentFired(@CurrentUser() user: JwtPayload) {
    if (!user.schoolId) return [];
    return this.alerts.getRecentFired(user.schoolId);
  }

  @Post('school/:schoolId/trigger')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Ejecutar alertas manualmente (test/admin)' })
  trigger(@Param('schoolId') schoolId: string) {
    return this.alerts.triggerManual(schoolId);
  }
}
