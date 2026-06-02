import { Module } from '@nestjs/common';

import { CoursesModule } from '../courses/courses.module.js';
import { SchoolConfigController } from './school-config.controller.js';
import { SchoolConfigService } from './school-config.service.js';

@Module({
  imports: [CoursesModule],
  controllers: [SchoolConfigController],
  providers: [SchoolConfigService],
  exports: [SchoolConfigService],
})
export class SchoolConfigModule {}
