import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { BrevoClient } from './brevo.client.js';
import { MailService } from './mail.service.js';

const MAX_ATTEMPTS = 4;
const BATCH_SIZE = 20; // per cron tick

@Injectable()
export class MailQueueProcessor {
  private readonly log = new Logger(MailQueueProcessor.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly brevo: BrevoClient,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'mail-queue-drain' })
  async drain() {
    if (!this.mail.enabled) return;
    if (this.running) return;
    this.running = true;
    try {
      const { remaining } = await this.mail.quotaStatus();
      if (remaining <= 0) {
        this.log.debug(`quota exhausted — skipping drain`);
        return;
      }

      const take = Math.min(BATCH_SIZE, remaining);
      const now = new Date();
      const candidates = await this.prisma.mailOutbox.findMany({
        where: {
          status: MailStatus.PENDING,
          OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }], // HIGH < NORMAL < LOW alphabetically
        take,
      });

      if (!candidates.length) return;
      this.log.log(`draining ${candidates.length} mails (remaining quota: ${remaining})`);

      for (const m of candidates) {
        await this.sendOne(m);
      }
    } catch (e) {
      this.log.error(`drain error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sendOne(m: {
    id: string;
    toEmail: string;
    toName: string | null;
    subject: string;
    htmlBody: string;
    textBody: string | null;
    category: string;
    attempts: number;
  }) {
    // Mark SENDING to avoid double-send on concurrent ticks
    const claimed = await this.prisma.mailOutbox.updateMany({
      where: { id: m.id, status: MailStatus.PENDING },
      data: { status: MailStatus.SENDING, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return;

    try {
      const res = await this.brevo.send({
        to: m.toName ? { email: m.toEmail, name: m.toName } : { email: m.toEmail },
        subject: m.subject,
        html: m.htmlBody,
        ...(m.textBody ? { text: m.textBody } : {}),
        tag: m.category,
      });
      await this.prisma.mailOutbox.update({
        where: { id: m.id },
        data: {
          status: MailStatus.SENT,
          sentAt: new Date(),
          providerMsgId: res.messageId || null,
          lastError: null,
        },
      });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      const attempts = m.attempts + 1;
      const shouldRetry = attempts < MAX_ATTEMPTS && !isFatalError(msg);
      const data: Prisma.MailOutboxUpdateInput = {
        status: shouldRetry ? MailStatus.PENDING : MailStatus.FAILED,
        lastError: msg,
      };
      if (shouldRetry) {
        // backoff: 5min * 2^attempts
        data.scheduledFor = new Date(Date.now() + 5 * 60 * 1000 * Math.pow(2, attempts));
      }
      await this.prisma.mailOutbox.update({ where: { id: m.id }, data });
      this.log.warn(`send fail [${m.id}] attempt ${attempts}: ${msg}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'mail-cleanup-old' })
  async cleanup() {
    // Purge SENT older than 90 days, FAILED older than 30 days
    const now = Date.now();
    const r1 = await this.prisma.mailOutbox.deleteMany({
      where: { status: MailStatus.SENT, sentAt: { lt: new Date(now - 90 * 86_400_000) } },
    });
    const r2 = await this.prisma.mailOutbox.deleteMany({
      where: {
        status: { in: [MailStatus.FAILED, MailStatus.CANCELLED] },
        createdAt: { lt: new Date(now - 30 * 86_400_000) },
      },
    });
    if (r1.count || r2.count)
      this.log.log(`cleanup: purged ${r1.count} sent + ${r2.count} failed/cancelled`);
  }
}

function isFatalError(msg: string): boolean {
  // 4xx semantic errors (bad email, invalid key, etc.) should not retry
  return /^Brevo 4(0[0-5]|06|22)/.test(msg);
}
