import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SchoolConfigModule } from '../school-config/school-config.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { LateAttendanceController } from './late-attendance.controller.js';
import { LateAttendanceService } from './late-attendance.service.js';

@Module({
  imports: [CoursesModule, CalendarModule, MailModule, SchoolConfigModule],
  controllers: [AttendanceController, LateAttendanceController],
  providers: [AttendanceService, LateAttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
