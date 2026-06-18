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
    void res.header('Content-Type', this.backupContentType(download.fileName));
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
    void res.header('Content-Type', this.backupContentType(download.fileName));
    void res.header('Content-Length', String(download.size));
    void res.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(download.fileName)}"`,
    );
    void res.send(createReadStream(download.filePath));
  }

  @Get('backup/history')
  @ApiOperation({ summary: 'Historial de respaldos disponibles en el servidor' })
  getBackupHistory() {
    return this.systemConfig.listBackupHistory();
  }

  @Get('backup/file')
  @ApiOperation({ summary: 'Descargar un respaldo del historial por nombre (admin)' })
  async downloadBackupByName(@Query('name') name: string | undefined, @Res() res: FastifyReply) {
    const download = await this.systemConfig.getBackupFileByName(name ?? '');
    void res.header('Content-Type', this.backupContentType(download.fileName));
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

  @Post('backup/generate-download')
  @ApiOperation({ summary: 'Generar un respaldo fresco y descargarlo al instante (sin correo)' })
  async generateAndDownload(@Res() res: FastifyReply) {
    const download = await this.systemConfig.generateAndDownload();
    void res.header('Content-Type', this.backupContentType(download.fileName));
    void res.header('Content-Length', String(download.size));
    void res.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(download.fileName)}"`,
    );
    void res.send(createReadStream(download.filePath));
  }

  private backupContentType(fileName: string): string {
    if (fileName.endsWith('.zip')) return 'application/zip';
    if (fileName.endsWith('.7z')) return 'application/x-7z-compressed';
    return 'application/octet-stream';
  }
}
