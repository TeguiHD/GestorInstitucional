import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { UpdateBackupConfigDto } from './dto/update-backup-config.dto.js';
import { SystemConfigService } from './system-config.service.js';

@ApiTags('system-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(SystemRole.SUPER_ADMIN)
@Controller('system-config')
export class SystemConfigController {
  constructor(private readonly systemConfig: SystemConfigService) {}

  @Get('backup')
  @ApiOperation({ summary: 'Obtener configuración del backup automático de base de datos' })
  getBackupConfig() {
    return this.systemConfig.getBackupConfig();
  }

  @Put('backup')
  @ApiOperation({ summary: 'Actualizar configuración del backup automático de base de datos' })
  updateBackupConfig(@Body() dto: UpdateBackupConfigDto) {
    return this.systemConfig.updateBackupConfig(dto);
  }

  @Post('backup/test')
  @ApiOperation({ summary: 'Ejecutar una prueba manual del backup ahora' })
  testBackup() {
    return this.systemConfig.testBackup();
  }
}
