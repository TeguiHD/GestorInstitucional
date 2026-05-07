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
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
import type { AppConfig } from '../config/configuration.js';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly totp: TotpService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ── Cookie helpers ───────────────────────────────────────────────────────

  private refreshTtlSeconds(): number {
    const ttl = this.config.get('jwt.refreshTtl', { infer: true });
    const match = /^(\d+)([smhd])$/.exec(ttl);
    const value = Number(match?.[1] ?? 7);
    const unit = (match?.[2] ?? 'd') as 's' | 'm' | 'h' | 'd';
    return value * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  }

  private setRefreshCookie(res: FastifyReply, token: string): void {
    void res.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get('cookie.secure', { infer: true }),
      sameSite: this.config.get('cookie.sameSite', { infer: true }) as 'strict' | 'lax' | 'none',
      path: '/api/v1/auth',
      maxAge: this.refreshTtlSeconds(),
    });
  }

  private clearRefreshCookie(res: FastifyReply): void {
    void res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  private cookieToken(req: FastifyRequest): string | undefined {
    return (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
  }

  // ── Endpoints ────────────────────────────────────────────────────────────

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: seconds(300), limit: 5 } })
  @ApiOperation({ summary: 'Login con email + contraseña (+ TOTP si activo)' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.auth.login(dto, req.ip, req.headers['user-agent']);

    // Move refresh token to httpOnly cookie; strip it from the response body
    if ('refreshToken' in result && result.refreshToken) {
      this.setRefreshCookie(res, result.refreshToken);
      const { refreshToken: _rt, ...rest } = result;
      return rest;
    }

    return result;
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SystemRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar nuevo usuario (SUPER_ADMIN)' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: seconds(300), limit: 10 } })
  @ApiOperation({ summary: 'Rotar refresh token — lee cookie httpOnly' })
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = this.cookieToken(req);
    if (!token) throw new UnauthorizedException('Sin sesión activa');
    const pair = await this.auth.refresh(token, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(res, pair.refreshToken);
    return { accessToken: pair.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cerrar sesión (revoca refresh token actual)' })
  @ApiBearerAuth()
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const token = this.cookieToken(req);
    await this.auth.logout(user.sub, token);
    this.clearRefreshCookie(res);
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
    @Res({ passthrough: true }) res: FastifyReply,
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
      this.setRefreshCookie(res, pair.refreshToken);
      return { success: true, accessToken: pair.accessToken };
    }

    return { success: true, message: '2FA activado' };
  }

  @Get('2fa/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estado 2FA propio' })
  async status2fa(@CurrentUser() user: JwtPayload) {
    const enabled = await this.totp.isEnabled(user.sub);
    return {
      enabled,
      backupCodesRemaining: enabled ? await this.totp.countBackupCodes(user.sub) : 0,
    };
  }

  @Post('2fa/backup-codes')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerar códigos de respaldo 2FA (requiere TOTP)' })
  async regenerateBackupCodes(@CurrentUser() user: JwtPayload, @Body('code') code: string) {
    const valid = await this.totp.verify(user.sub, code);
    if (!valid) throw new UnauthorizedException('Código 2FA inválido');
    return { backupCodes: await this.totp.regenerateBackupCodes(user.sub) };
  }

  @Delete('2fa')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar 2FA (requiere código TOTP vigente)' })
  async disable2fa(
    @CurrentUser() user: JwtPayload,
    @Body('code') code: string,
  ): Promise<{ success: boolean }> {
    const valid = await this.totp.verify(user.sub, code);
    if (!valid) throw new UnauthorizedException('Código 2FA inválido');
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
