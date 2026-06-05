import { seconds, ThrottlerModule } from '@nestjs/throttler';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './auth/auth.module.js';
import configuration, { validateConfig, type AppConfig } from './config/configuration.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { CoursesModule } from './courses/courses.module.js';
import { StudentsModule } from './students/students.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { JustificationsModule } from './justifications/justifications.module.js';
import { MailModule } from './mail/mail.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { SchoolConfigModule } from './school-config/school-config.module.js';
import { SystemConfigModule } from './system-config/system-config.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateConfig,
      cache: true,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const isDev = config.get('nodeEnv', { infer: true }) !== 'production';
        return {
          pinoHttp: {
            level: config.get('logging.level', { infer: true }),
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.refreshToken',
              'req.body.totpCode',
              'req.body.deviceToken',
              'res.headers["set-cookie"]',
            ],
            ...(isDev
              ? {
                  transport: {
                    target: 'pino-pretty',
                    options: { colorize: true, singleLine: true },
                  },
                }
              : {}),
          },
        };
      },
    }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        throttlers: [
          {
            name: 'global',
            ttl: seconds(config.get('rateLimit.global.ttl', { infer: true })),
            limit: config.get('rateLimit.global.max', { infer: true }),
          },
        ],
      }),
    }),

    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    StudentsModule,
    AttendanceModule,
    ReportsModule,
    InsightsModule,
    CalendarModule,
    JustificationsModule,
    MailModule,
    AlertsModule,
    RetentionModule,
    SchoolConfigModule,
    SystemConfigModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
