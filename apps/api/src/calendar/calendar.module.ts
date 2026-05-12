import { forwardRef, Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({
  imports: [forwardRef(() => MailModule), CoursesModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
