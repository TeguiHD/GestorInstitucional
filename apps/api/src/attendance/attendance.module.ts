import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  imports: [CoursesModule, CalendarModule, MailModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
