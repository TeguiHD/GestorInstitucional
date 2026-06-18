import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  // Solo SUPER_ADMIN: el AuditEvent no tiene schoolId, así que no se puede acotar
  // por colegio; permitir DIRECTOR filtraría auditoría de todos los colegios.
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Historial de auditoría' })
  list(
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.list({
      ...(entity ? { entity } : {}),
      ...(entityId ? { entityId } : {}),
      ...(userId ? { userId } : {}),
      ...(action ? { action } : {}),
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
  }
}
