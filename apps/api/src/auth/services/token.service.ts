import * as crypto from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../../common/decorators/current-user.decorator.js';

export type TokenPair = { accessToken: string; refreshToken: string };

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async issueSetupToken(
    userId: string,
    email: string,
    schoolId: string,
    roles: string[],
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, email, schoolId, roles, totpVerified: false, totpSetupRequired: true },
      { secret: this.config.get('jwt.accessSecret', { infer: true }), expiresIn: '5m' },
    );
  }

  async issueTokenPair(
    payload: Omit<JwtPayload, 'iat' | 'exp'>,
    ip?: string,
    ua?: string,
  ): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('jwt.accessSecret', { infer: true }),
        expiresIn: this.config.get('jwt.accessTtl', { infer: true }),
      }),
      this.generateRefreshToken(),
    ]);

    const tokenHash = this.hashToken(refreshToken);
    const family = crypto.randomUUID();
    const ttlMs = this.parseTtlToMs(this.config.get('jwt.refreshTtl', { infer: true }));

    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash,
        family,
        ip: ip ?? null,
        userAgent: ua ?? null,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    return { accessToken, refreshToken };
  }

  async rotateRefreshToken(rawToken: string, ip?: string, ua?: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) throw new UnauthorizedException('Refresh token inválido');
    if (stored.revokedAt) {
      // Reuse detected → revoke entire family (token theft)
      await this.prisma.refreshToken.updateMany({
        where: { family: stored.family },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Token reutilizado — sesión revocada por seguridad');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    // Mark current as used+revoked
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), usedAt: new Date() },
    });

    // Get user to rebuild payload
    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { schoolRoles: true },
    });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Usuario inactivo o eliminado');
    }

    // Issue new pair — same family
    const newRawToken = await this.generateRefreshToken();
    const newHash = this.hashToken(newRawToken);
    const ttlMs = this.parseTtlToMs(this.config.get('jwt.refreshTtl', { infer: true }));

    const schoolId = stored.userId; // will be overridden below — placeholder
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      schoolId,
      roles: user.schoolRoles.map((r) => r.role),
      totpVerified: true,
    };

    const [accessToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('jwt.accessSecret', { infer: true }),
        expiresIn: this.config.get('jwt.accessTtl', { infer: true }),
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newHash,
          family: stored.family,
          ip: ip ?? null,
          userAgent: ua ?? null,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      }),
    ]);

    return { accessToken, refreshToken: newRawToken };
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private generateRefreshToken(): Promise<string> {
    return new Promise((resolve, reject) =>
      crypto.randomBytes(64, (err, buf) => {
        if (err) reject(err);
        else resolve(buf.toString('base64url'));
      }),
    );
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private parseTtlToMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) throw new Error(`Invalid TTL: ${ttl}`);
    const value = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * multipliers[unit];
  }
}
