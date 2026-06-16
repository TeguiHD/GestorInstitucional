import { createReadStream } from 'fs';

import { Body, Controller, Get, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import type { FastifyReply } from 'fastify';

import { Public } from '../common/decorators/public.decorator.js';
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

  @Get('backup/latest-download')
  @ApiOperation({ summary: 'Descargar el último respaldo completo confirmado' })
  async downloadLatestBackup(@Res() res: FastifyReply) {
    const download = await this.systemConfig.getLatestBackupDownload();
    void res.header('Content-Type', 'application/zip');
    void res.header('Content-Length', String(download.size));
    void res.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(download.fileName)}"`,
    );
    void res.send(createReadStream(download.filePath));
  }

  @Public()
  @Roles()
  @Get('backup/download')
  @ApiOperation({ summary: 'Descargar respaldo cifrado con token temporal' })
  async downloadBackup(@Query('token') token: string | undefined, @Res() res: FastifyReply) {
    const download = await this.systemConfig.getBackupDownload(token);
    void res.header('Content-Type', 'application/zip');
    void res.header('Content-Length', String(download.size));
    void res.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(download.fileName)}"`,
    );
    void res.send(createReadStream(download.filePath));
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
