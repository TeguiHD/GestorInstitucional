import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendarDayType, SystemRole } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { CoursesService } from '../courses/courses.service.js';
import { CalendarService } from './calendar.service.js';

class CreateCalendarDayDto {
  @ApiProperty() @IsUUID() schoolId!: string;
  @ApiProperty({ example: '2026-05-01' }) @IsDateString() date!: string;
  @ApiProperty({ enum: CalendarDayType }) @IsEnum(CalendarDayType) type!: CalendarDayType;
  @ApiProperty() @IsString() @MaxLength(200) description!: string;
  @ApiProperty({ required: false, description: 'Enviar aviso masivo a apoderados' })
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

class SeedHolidaysDto {
  @ApiProperty() @IsUUID() schoolId!: string;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) year!: number;
}

@ApiTags('calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly courses: CoursesService,
  ) {}

  @Get('school/:schoolId')
  @ApiOperation({ summary: 'Días especiales del colegio (feriados/suspendidos/eventos)' })
  list(
    @Param('schoolId') schoolId: string,
    @Query('year') year: number | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    // BUG-07: all staff roles can read calendar — validate school access only
    this.courses.assertSchoolAccess(schoolId, user);
    return this.calendar.listBySchool(schoolId, year ? Number(year) : undefined);
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Crear/actualizar día especial' })
  create(@Body() dto: CreateCalendarDayDto, @CurrentUser() user: JwtPayload) {
    this.courses.assertSchoolAccess(dto.schoolId, user);
    return this.calendar.create(dto);
  }

  @Post('seed-chile')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Poblar feriados oficiales fijos Chile (año completo)' })
  seedChile(@Body() dto: SeedHolidaysDto, @CurrentUser() user: JwtPayload) {
    this.courses.assertSchoolAccess(dto.schoolId, user);
    return this.calendar.seedChileHolidays(dto.schoolId, dto.year);
  }

  @Delete(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Eliminar día especial' })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    this.courses.assertSchoolAccess(await this.calendar.getDaySchoolId(id), user);
    return this.calendar.remove(id);
  }

  @Post(':id/notify')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Reenviar aviso masivo a apoderados sobre este día' })
  async notify(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    this.courses.assertSchoolAccess(await this.calendar.getDaySchoolId(id), user);
    return this.calendar.broadcastDay(id);
  }
}
