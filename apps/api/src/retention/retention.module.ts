import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RetentionController } from './retention.controller.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [RetentionController],
  providers: [RetentionService],
})
export class RetentionModule {}
