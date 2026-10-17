import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { ResolveLateDto } from './dto/resolve-late.dto.js';
import { LateAttendanceService, type LateState } from './late-attendance.service.js';

@ApiTags('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
@Controller('attendance/late')
export class LateAttendanceController {
  constructor(private readonly service: LateAttendanceService) {}

  @Get('school/:schoolId')
  @ApiOperation({ summary: 'Atrasos pendientes o resueltos del colegio (paginado)' })
  list(
    @Param('schoolId') schoolId: string,
    @CurrentUser() user: JwtPayload,
    @Query('state') state?: string,
    @Query('courseId') courseId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const resolvedState: LateState = state === 'resolved' ? 'resolved' : 'pending';
    const opts: {
      state: LateState;
      courseId?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } = { state: resolvedState };
    if (courseId) opts.courseId = courseId;
    if (q) opts.q = q.slice(0, 80);
    if (limit !== undefined) {
      const lim = Number(limit);
      if (!Number.isInteger(lim) || lim < 1) throw new BadRequestException('limit inválido');
      opts.limit = lim;
    }
    if (offset !== undefined) {
      const off = Number(offset);
      if (!Number.isInteger(off) || off < 0 || off > 100_000)
        throw new BadRequestException('offset inválido');
      opts.offset = off;
    }
    return this.service.list(schoolId, user, opts);
  }

  @Post('resolve')
  @ApiOperation({ summary: 'Resolver atrasos pendientes en lote (todo o nada)' })
  resolve(@Body() dto: ResolveLateDto, @CurrentUser() user: JwtPayload) {
    return this.service.resolve(user, dto);
  }
}
