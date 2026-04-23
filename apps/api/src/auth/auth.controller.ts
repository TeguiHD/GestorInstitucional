import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { seconds } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { SystemRole } from '@prisma/client';

import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { AuthService } from './auth.service.js';
import { TotpService } from './services/totp.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly totp: TotpService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: seconds(300), limit: 10 } })
  @ApiOperation({ summary: 'Login con email + contraseña (+ TOTP si activo)' })
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    return this.auth.login(dto, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar nuevo usuario (SUPER_ADMIN only en prod)' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotar refresh token' })
  refresh(@Body('refreshToken') token: string, @Req() req: FastifyRequest) {
    return this.auth.refresh(token, req.ip, req.headers['user-agent']);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cerrar sesión (revoca refresh token actual)' })
  @ApiBearerAuth()
  logout(@CurrentUser() user: JwtPayload, @Body('refreshToken') token?: string) {
    return this.auth.logout(user.sub, token);
  }

  @Post('2fa/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Iniciar configuración TOTP — devuelve QR + backup codes' })
  setup2fa(@CurrentUser() user: JwtPayload) {
    return this.totp.generateSetup(user.sub, user.email);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verificar y activar TOTP' })
  async verify2fa(
    @CurrentUser() user: JwtPayload,
    @Body('code') code: string,
    @Req() req: FastifyRequest,
  ) {
    const valid = await this.totp.verify(user.sub, code);
    if (!valid) return { success: false, message: 'Código inválido' };

    if (user.totpSetupRequired) {
      const pair = await this.auth.completeTotpSetup(
        user.sub,
        user.email,
        user.schoolId,
        user.roles,
        req.ip,
        req.headers['user-agent'],
      );
      return { success: true, ...pair };
    }

    return { success: true, message: '2FA activado' };
  }

  @Delete('2fa')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar 2FA (requiere código TOTP vigente)' })
  async disable2fa(
    @CurrentUser() user: JwtPayload,
    @Body('code') code: string,
  ): Promise<{ success: boolean }> {
    const valid = await this.totp.verify(user.sub, code);
    if (!valid) return { success: false };
    await this.totp.disable(user.sub);
    return { success: true };
  }

  @Post('admin/unlock/:userId')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desbloquear cuenta de usuario (SUPER_ADMIN/DIRECTOR)' })
  unlock(@Param('userId') userId: string, @CurrentUser() actor: JwtPayload) {
    return this.auth.unlockUser(userId, actor.sub);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil del usuario autenticado' })
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
