import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { BrevoClient } from './brevo.client.js';
import { MailController } from './mail.controller.js';
import { MailQueueProcessor } from './mail.queue.js';
import { MailService } from './mail.service.js';
import { WhatsAppService } from './whatsapp.service.js';
import { WeeklyDigestCron } from './weekly-digest.cron.js';

@Module({
  imports: [PrismaModule],
  controllers: [MailController],
  providers: [MailService, BrevoClient, MailQueueProcessor, WeeklyDigestCron, WhatsAppService],
  exports: [MailService, WhatsAppService],
})
export class MailModule {}
