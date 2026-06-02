import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { IsDateString } from 'class-validator';

import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CoursesService } from '../courses/courses.service.js';
import { SchoolConfigService } from './school-config.service.js';

class UpdateAcademicYearConfigDto {
  @ApiProperty({ example: '2026-03-04' })
  @IsDateString()
  firstSemesterStart!: string;

  @ApiProperty({ example: '2026-06-18' })
  @IsDateString()
  firstSemesterEnd!: string;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  secondSemesterStart!: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  secondSemesterEnd!: string;
}

@ApiTags('school-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('school-config')
export class SchoolConfigController {
  constructor(
    private readonly schoolConfig: SchoolConfigService,
    private readonly courses: CoursesService,
  ) {}

  @Get(':schoolId/academic-year/:year')
  @ApiOperation({ summary: 'Configuración de año escolar por colegio y año' })
  getAcademicYearConfig(
    @Param('schoolId') schoolId: string,
    @Param('year') year: string,
    @CurrentUser() user: JwtPayload,
  ) {
    this.courses.assertSchoolAccess(schoolId, user);
    return this.schoolConfig.getAcademicYearConfig(schoolId, this.parseYear(year));
  }

  @Put(':schoolId/academic-year/:year')
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Crear o actualizar configuración de año escolar' })
  updateAcademicYearConfig(
    @Param('schoolId') schoolId: string,
    @Param('year') year: string,
    @Body() dto: UpdateAcademicYearConfigDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.courses.assertSchoolAccess(schoolId, user);
    return this.schoolConfig.upsertAcademicYearConfig(
      schoolId,
      this.parseYear(year),
      dto,
      user.sub,
    );
  }

  private parseYear(value: string): number {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new BadRequestException('year fuera de rango');
    }
    return year;
  }
}
