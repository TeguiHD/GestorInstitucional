import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { SystemRole, UserStatus } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.toLowerCase()?.trim())
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  schoolId!: string;

  @ApiProperty({ enum: SystemRole })
  @IsEnum(SystemRole)
  role!: SystemRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  sendWelcomeEmail?: boolean;
}

class UpdateUserDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({ required: false, enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

class UpdateRolesDto {
  @ApiProperty({ enum: SystemRole, isArray: true })
  @IsArray()
  @IsEnum(SystemRole, { each: true })
  roles!: SystemRole[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  schoolId!: string;
}

class ChangeOwnPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

@ApiTags('schools')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('schools')
export class SchoolsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Listar colegios (solo SUPER_ADMIN)' })
  findAll() {
    return this.prisma.school.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
  }
}

@ApiTags('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil propio' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.users.findById(user.sub);
  }

  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar contraseña propia' })
  changeOwnPassword(@Body() dto: ChangeOwnPasswordDto, @CurrentUser() user: JwtPayload) {
    return this.users.changeOwnPassword(user.sub, dto);
  }

  @Get('trash')
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Papelera de usuarios (SUPER_ADMIN)' })
  @ApiQuery({ name: 'schoolId', required: true })
  findTrashed(@Query('schoolId') schoolId: string, @CurrentUser() actor: JwtPayload) {
    return this.users.findTrashed(schoolId, actor);
  }

  @Get(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiOperation({ summary: 'Usuario por ID' })
  findOne(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.findByIdForActor(id, actor);
  }

  @Get()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.INSPECTORIA)
  @ApiQuery({ name: 'schoolId', required: true })
  @ApiQuery({ name: 'roles', required: false, isArray: true, enum: SystemRole })
  @ApiOperation({ summary: 'Listar usuarios de un colegio' })
  findAll(
    @Query('schoolId') schoolId: string,
    @CurrentUser() actor: JwtPayload,
    @Query('roles') roles?: SystemRole[],
  ) {
    return this.users.findBySchoolForActor(schoolId, actor, roles);
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Crear usuario con rol (genera contraseña temporal)' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: JwtPayload) {
    return this.users.createUser(dto, actor);
  }

  @Patch(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Actualizar nombre o estado de usuario' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: JwtPayload) {
    return this.users.updateUser(id, dto, actor);
  }

  @Patch(':id/roles')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Reemplazar roles de usuario en un colegio' })
  updateRoles(
    @Param('id') id: string,
    @Body() dto: UpdateRolesDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.users.updateRoles(id, dto.schoolId, dto.roles, actor);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Desbloquear cuenta (resetea failedLogins)' })
  unlock(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.unlockUser(id, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Resetear contraseña (genera temporal)' })
  resetPassword(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.resetPassword(id, actor);
  }

  @Post(':id/restore')
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Restaurar usuario eliminado' })
  restore(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.restore(id, actor);
  }

  @Delete(':id/purge')
  @Roles(SystemRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purgar usuario definitivamente (Ley 21.719)' })
  purge(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.purge(id, actor);
  }

  @Delete(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Soft-delete usuario' })
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.softDelete(id, actor);
  }
}
