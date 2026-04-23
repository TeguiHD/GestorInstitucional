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
  roles!: SystemRole[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  schoolId!: string;
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

  @Get(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Usuario por ID' })
  findOne(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Get()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiQuery({ name: 'schoolId', required: true })
  @ApiQuery({ name: 'roles', required: false, isArray: true, enum: SystemRole })
  @ApiOperation({ summary: 'Listar usuarios de un colegio' })
  findAll(@Query('schoolId') schoolId: string, @Query('roles') roles?: SystemRole[]) {
    return this.users.findBySchool(schoolId, roles);
  }

  @Post()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Crear usuario con rol (genera contraseña temporal)' })
  create(@Body() dto: CreateUserDto) {
    return this.users.createUser(dto);
  }

  @Patch(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Actualizar nombre o estado de usuario' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(id, dto);
  }

  @Patch(':id/roles')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Reemplazar roles de usuario en un colegio' })
  updateRoles(@Param('id') id: string, @Body() dto: UpdateRolesDto) {
    return this.users.updateRoles(id, dto.schoolId, dto.roles);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Desbloquear cuenta (resetea failedLogins)' })
  unlock(@Param('id') id: string) {
    return this.users.unlockUser(id);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Resetear contraseña (genera temporal)' })
  resetPassword(@Param('id') id: string) {
    return this.users.resetPassword(id);
  }

  @Delete(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Soft-delete usuario' })
  remove(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.users.softDelete(id, actor.sub);
  }
}
