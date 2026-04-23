import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

import type { AppConfig } from '../config/configuration.js';

@Injectable()
export class WhatsAppService {
  private readonly log = new Logger(WhatsAppService.name);
  private client: ReturnType<typeof Twilio> | null = null;
  private from: string = 'whatsapp:+14155238886';

  constructor(config: ConfigService<AppConfig, true>) {
    const cfg = config.get('twilio', { infer: true });
    if (cfg.enabled && cfg.accountSid && cfg.authToken) {
      this.client = Twilio(cfg.accountSid, cfg.authToken);
      this.from = cfg.whatsappFrom;
      this.log.log('WhatsApp service enabled via Twilio');
    } else {
      this.log.debug('WhatsApp disabled — set TWILIO_ENABLED=true to activate');
    }
  }

  async sendAbsenceAlert(params: {
    guardianPhone: string;
    studentName: string;
    courseName: string;
    date: Date;
    schoolName: string;
    status: 'ABSENT' | 'LATE';
  }): Promise<void> {
    if (!this.client) return;

    const dateStr = params.date.toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const statusText =
      params.status === 'LATE'
        ? `llegó tarde al curso *${params.courseName}*`
        : `no asistió al curso *${params.courseName}*`;

    const body =
      `🏫 *${params.schoolName}*\n\n` +
      `Estimado apoderado, le informamos que *${params.studentName}* ${statusText} el día *${dateStr}*.\n\n` +
      `Si tiene un certificado médico o justificación, puede subirlo desde el portal de apoderados.`;

    const to = params.guardianPhone.startsWith('whatsapp:')
      ? params.guardianPhone
      : `whatsapp:${params.guardianPhone}`;

    try {
      await this.client.messages.create({ from: this.from, to, body });
      this.log.log(`WhatsApp sent → ${params.guardianPhone}`);
    } catch (e) {
      this.log.warn(`WhatsApp failed → ${params.guardianPhone}: ${(e as Error).message}`);
    }
  }
}
