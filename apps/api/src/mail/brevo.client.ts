import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration.js';

type BrevoPayload = {
  sender: { email: string; name: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  tags?: string[];
};

type BrevoResponse = { messageId?: string; messageIds?: string[] };

@Injectable()
export class BrevoClient {
  private readonly log = new Logger(BrevoClient.name);
  private readonly endpoint = 'https://api.brevo.com/v3/smtp/email';

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async send(input: {
    to: { email: string; name?: string };
    subject: string;
    html: string;
    text?: string;
    tag?: string;
  }): Promise<{ messageId: string }> {
    const apiKey = this.config.get('mail.brevoApiKey', { infer: true });
    const fromEmail = this.config.get('mail.fromEmail', { infer: true });
    const fromName = this.config.get('mail.fromName', { infer: true });

    if (!apiKey) throw new Error('BREVO_API_KEY no configurado');

    const payload: BrevoPayload = {
      sender: { email: fromEmail, name: fromName },
      to: [
        input.to.name ? { email: input.to.email, name: input.to.name } : { email: input.to.email },
      ],
      subject: input.subject,
      htmlContent: input.html,
      ...(input.text ? { textContent: input.text } : {}),
      ...(input.tag ? { tags: [input.tag] } : {}),
    };

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Brevo ${res.status}: ${body.slice(0, 400)}`);
    }

    const data = (await res.json().catch(() => ({}))) as BrevoResponse;
    const messageId = data.messageId ?? data.messageIds?.[0] ?? '';
    return { messageId };
  }

  async getAccountInfo(): Promise<{ remaining: number | null; raw: unknown }> {
    const apiKey = this.config.get('mail.brevoApiKey', { infer: true });
    if (!apiKey) return { remaining: null, raw: null };
    try {
      const res = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': apiKey, accept: 'application/json' },
      });
      if (!res.ok) return { remaining: null, raw: null };
      const data = (await res.json()) as { plan?: { credits?: number; type?: string }[] };
      const plan = data.plan?.find((p) => p.type === 'sendLimit') ?? data.plan?.[0];
      return { remaining: plan?.credits ?? null, raw: data };
    } catch (e) {
      this.log.warn(`Brevo account info error: ${(e as Error).message}`);
      return { remaining: null, raw: null };
    }
  }
}
