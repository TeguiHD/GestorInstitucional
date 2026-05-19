import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [CoursesModule, AuditModule],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
