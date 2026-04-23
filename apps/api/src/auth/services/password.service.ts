import * as crypto from 'node:crypto';
import * as https from 'node:https';

import * as argon2 from 'argon2';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';

@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      memoryCost: this.config.get('argon2.memoryCost', { infer: true }),
      timeCost: this.config.get('argon2.timeCost', { infer: true }),
      parallelism: this.config.get('argon2.parallelism', { infer: true }),
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  async needsRehash(hash: string): Promise<boolean> {
    return argon2.needsRehash(hash, {
      memoryCost: this.config.get('argon2.memoryCost', { infer: true }),
      timeCost: this.config.get('argon2.timeCost', { infer: true }),
      parallelism: this.config.get('argon2.parallelism', { infer: true }),
    });
  }

  /** HIBP k-anonymity check (SHA-1 prefix). Throws if API unreachable — treated as warning. */
  async isPwned(password: string): Promise<boolean> {
    if (!this.config.get('hibp.enabled', { infer: true })) return false;

    try {
      const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);

      const body = await this.fetchHibp(prefix);
      return body.split('\r\n').some((line) => line.startsWith(suffix));
    } catch {
      // Non-blocking — degraded mode if HIBP unavailable
      return false;
    }
  }

  private fetchHibp(prefix: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        { headers: { 'Add-Padding': 'true' } },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error('HIBP timeout'));
      });
    });
  }
}
