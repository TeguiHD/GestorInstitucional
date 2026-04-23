import { forwardRef, Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({
  imports: [forwardRef(() => MailModule)],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
