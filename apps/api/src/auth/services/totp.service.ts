import * as crypto from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';

import type { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';

export type TotpSetupResult = {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
};

@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly passwords: PasswordService,
  ) {
    authenticator.options = {
      window: this.config.get('totp.window', { infer: true }),
    };
  }

  async generateSetup(userId: string, userEmail: string): Promise<TotpSetupResult> {
    const secret = authenticator.generateSecret(32);
    const issuer = this.config.get('totp.issuer', { infer: true });
    const otpauthUrl = authenticator.keyuri(userEmail, issuer, secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    const backupCodes = this.generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => this.passwords.hash(c)));

    // Store unverified — only mark verified after first successful check
    await this.prisma.totpSecret.upsert({
      where: { userId },
      update: {
        secret: this.encryptSecret(secret),
        verified: false,
        backupCodes: hashedCodes,
        verifiedAt: null,
      },
      create: {
        userId,
        secret: this.encryptSecret(secret),
        verified: false,
        backupCodes: hashedCodes,
      },
    });

    return { otpauthUrl, qrCodeDataUrl, backupCodes };
  }

  async verify(userId: string, token: string): Promise<boolean> {
    const record = await this.prisma.totpSecret.findUnique({ where: { userId } });
    if (!record) throw new UnauthorizedException('2FA no configurado');

    const secret = this.decryptSecret(record.secret);
    // checkDelta devuelve el desfase de ventana (o null) para conocer el timestep
    // exacto que validó y poder rechazar su reuso (anti-replay, RFC 6238 §5.2).
    const delta = authenticator.checkDelta(token, secret);
    if (delta === null) return false;

    const period = authenticator.options.step ?? 30;
    const step = Math.floor(Date.now() / 1000 / period) + delta;
    if (record.lastTotpStep != null && step <= record.lastTotpStep) {
      // Código de un timestep ya consumido: replay.
      return false;
    }

    await this.prisma.totpSecret.update({
      where: { userId },
      data: {
        lastTotpStep: step,
        ...(record.verified ? {} : { verified: true, verifiedAt: new Date() }),
      },
    });

    return true;
  }

  async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const record = await this.prisma.totpSecret.findUnique({ where: { userId } });
    if (!record) return false;

    const codes = record.backupCodes as string[];
    for (let i = 0; i < codes.length; i++) {
      const hash = codes[i];
      if (!hash) continue;
      const match = await this.passwords.verify(hash, code);
      if (match) {
        // Burn the code — single use
        const updated = [...codes];
        updated.splice(i, 1);
        await this.prisma.totpSecret.update({
          where: { userId },
          data: { backupCodes: updated },
        });
        return true;
      }
    }
    return false;
  }

  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const record = await this.prisma.totpSecret.findUnique({ where: { userId } });
    if (!record?.verified) throw new UnauthorizedException('2FA no configurado');
    const backupCodes = this.generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => this.passwords.hash(c)));
    await this.prisma.totpSecret.update({
      where: { userId },
      data: { backupCodes: hashedCodes },
    });
    return backupCodes;
  }

  async countBackupCodes(userId: string): Promise<number> {
    const record = await this.prisma.totpSecret.findUnique({
      where: { userId },
      select: { backupCodes: true },
    });
    return Array.isArray(record?.backupCodes) ? record.backupCodes.length : 0;
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.totpSecret.deleteMany({ where: { userId } });
  }

  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.prisma.totpSecret.findUnique({ where: { userId } });
    return !!record?.verified;
  }

  async trustDevice(userId: string, userAgent?: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.trustedDevice.create({
      data: { userId, tokenHash, userAgent: userAgent ?? null, expiresAt },
    });
    return rawToken;
  }

  async isDeviceTrusted(userId: string, rawToken: string): Promise<boolean> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const device = await this.prisma.trustedDevice.findFirst({
      where: { userId, tokenHash, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return !!device;
  }

  async validateForLogin(userId: string, token?: string): Promise<void> {
    const enabled = await this.isEnabled(userId);
    if (!enabled) return;

    if (!token) throw new UnauthorizedException('Código 2FA requerido');

    const validTotp = await this.verify(userId, token);
    if (validTotp) return;

    const validBackup = await this.verifyBackupCode(userId, token);
    if (!validBackup) throw new UnauthorizedException('Código 2FA inválido');
  }

  private generateBackupCodes(count = 10): string[] {
    return Array.from({ length: count }, () =>
      crypto
        .randomBytes(5)
        .toString('hex')
        .toUpperCase()
        .match(/.{1,5}/g)!
        .join('-'),
    );
  }

  /** AES-256-GCM authenticated encryption. Key from TOTP_ENC_KEY env (32-byte hex). */
  private encryptSecret(secret: string): string {
    const key = Buffer.from(process.env['TOTP_ENC_KEY'] ?? '', 'hex');
    if (key.length !== 32) throw new Error('TOTP_ENC_KEY must be 32-byte hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv(12) | tag(16) | ciphertext — base64url encoded
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
  }

  private decryptSecret(encoded: string): string {
    const key = Buffer.from(process.env['TOTP_ENC_KEY'] ?? '', 'hex');
    if (key.length !== 32) throw new Error('TOTP_ENC_KEY must be 32-byte hex');
    const buf = Buffer.from(encoded, 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  }
}
