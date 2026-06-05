import { Module } from '@nestjs/common';

import { CalendarModule } from '../calendar/calendar.module.js';
import { MailModule } from '../mail/mail.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { SchoolConfigModule } from '../school-config/school-config.module.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

@Module({
  imports: [PrismaModule, MailModule, CoursesModule, CalendarModule, SchoolConfigModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
