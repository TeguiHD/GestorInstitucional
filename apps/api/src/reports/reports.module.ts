import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { SchoolConfigModule } from '../school-config/school-config.module.js';
import { StudentsModule } from '../students/students.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [AttendanceModule, CalendarModule, CoursesModule, StudentsModule, SchoolConfigModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
