import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { JustificationsService } from './justifications.service.js';

class ReviewDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(['APPROVED', 'REJECTED'] as const)
  decision!: 'APPROVED' | 'REJECTED';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@ApiTags('justifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('justifications')
export class JustificationsController {
  constructor(private readonly service: JustificationsService) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Subir certificado de justificación (multipart: file + recordId + reason)',
  })
  async upload(@Req() req: FastifyRequest, @CurrentUser() user: JwtPayload) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mp = await (req as any).file();
    if (!mp) throw new BadRequestException('Archivo requerido');
    const recordId = mp.fields?.recordId?.value as string | undefined;
    const reason = (mp.fields?.reason?.value as string | undefined) ?? '';
    if (!recordId) throw new BadRequestException('recordId requerido');
    if (!reason || reason.length > 500)
      throw new BadRequestException('Motivo requerido (máx 500 chars)');

    return this.service.upload({
      recordId,
      uploadedById: user.sub,
      actor: user,
      reason,
      file: { filename: mp.filename, mimetype: mp.mimetype, stream: mp.file },
    });
  }

  @Get('record/:recordId')
  @ApiOperation({ summary: 'Listar justificaciones de un registro' })
  listByRecord(@Param('recordId') recordId: string, @CurrentUser() user: JwtPayload) {
    return this.service.listByRecord(recordId, user);
  }

  @Get('student/:studentId')
  @ApiOperation({ summary: 'Listar justificaciones de un alumno' })
  listByStudent(@Param('studentId') studentId: string, @CurrentUser() user: JwtPayload) {
    return this.service.listByStudent(studentId, user);
  }

  @Get('school/:schoolId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Todas las justificaciones del colegio (paginado)' })
  listBySchool(
    @Param('schoolId') schoolId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const opts: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; limit?: number; offset?: number } =
      {};
    if (status !== undefined) opts.status = status;
    if (limit !== undefined) opts.limit = Number(limit);
    if (offset !== undefined) opts.offset = Number(offset);
    return this.service.listBySchool(schoolId, user, opts);
  }

  @Get('pending')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Justificaciones pendientes del colegio' })
  pending(@Query('schoolId') schoolId: string, @CurrentUser() user: JwtPayload) {
    return this.service.pendingBySchool(schoolId, user);
  }

  @Patch(':id/review')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Aprobar o rechazar justificación' })
  review(@Param('id') id: string, @Body() dto: ReviewDto, @CurrentUser() user: JwtPayload) {
    return this.service.review(id, user, dto.decision, dto.notes);
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Descargar certificado' })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: FastifyReply,
  ) {
    const j = await this.service.getFile(id, user);
    const safePath = resolve(j.filePath);
    const allowedRoot = resolve(process.env.UPLOADS_DIR ?? 'uploads');
    if (!safePath.startsWith(allowedRoot + '/') && safePath !== allowedRoot) {
      void res.status(403).send({ message: 'Ruta de archivo inválida' });
      return;
    }
    void res.header('Content-Type', j.mimeType);
    void res.header('Content-Disposition', `inline; filename="${encodeURIComponent(j.fileName)}"`);
    void res.send(createReadStream(safePath));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar justificación (solo autor antes de revisión)' })
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user);
  }
}
