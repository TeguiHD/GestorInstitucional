import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { SchoolConfigModule } from '../school-config/school-config.module.js';

@Module({
  imports: [CoursesModule, AuditModule, CalendarModule, SchoolConfigModule],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
