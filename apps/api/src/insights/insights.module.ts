import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { SchoolConfigModule } from '../school-config/school-config.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({
  imports: [CalendarModule, CoursesModule, SchoolConfigModule],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
