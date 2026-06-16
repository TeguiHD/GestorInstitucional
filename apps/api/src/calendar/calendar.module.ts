import { forwardRef, Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { SchoolConfigModule } from '../school-config/school-config.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({
  imports: [forwardRef(() => MailModule), CoursesModule, SchoolConfigModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
