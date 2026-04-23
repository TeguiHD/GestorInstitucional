import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';
import { JustificationsController } from './justifications.controller.js';
import { JustificationsService } from './justifications.service.js';

@Module({
  imports: [MailModule],
  controllers: [JustificationsController],
  providers: [JustificationsService],
  exports: [JustificationsService],
})
export class JustificationsModule {}
