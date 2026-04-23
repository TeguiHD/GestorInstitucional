import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SchoolsController, UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, MailModule, PrismaModule],
  controllers: [SchoolsController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
