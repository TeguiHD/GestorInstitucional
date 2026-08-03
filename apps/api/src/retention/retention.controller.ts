import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PurgeRetentionDto } from './dto/purge-retention.dto.js';
import { RetentionService } from './retention.service.js';

@ApiTags('admin/retention')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('admin/retention')
export class RetentionController {
  constructor(private readonly service: RetentionService) {}

  @Get('preview')
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Preview de registros que serían purgados (dry-run)' })
  preview(@CurrentUser() actor: JwtPayload) {
    return this.service.preview(actor);
  }

  @Post('purge')
  @Roles(SystemRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ejecutar purga de retención MINEDUC (IRREVERSIBLE)',
    description:
      'Borra definitivamente asistencia, justificaciones y auditoría fuera de plazo. ' +
      'Requiere: RETENTION_PURGE_ENABLED=true en el entorno, la frase de confirmación ' +
      'exacta, y los conteos obtenidos de GET /admin/retention/preview sin cambios.',
  })
  purge(@Body() dto: PurgeRetentionDto, @CurrentUser() actor: JwtPayload) {
    return this.service.purge(actor, dto);
  }
}
