import { Logger } from 'nestjs-pino';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<AppConfig, true>);
  const isProd = config.get('nodeEnv', { infer: true }) === 'production';

  // ---------- Security ----------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register((await import('@fastify/helmet')).default as any, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  const allowedOrigins = config.get('cors.origins', { infer: true });
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true,
    maxAge: 600,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register((await import('@fastify/cookie')).default as any, {
    secret: config.get('jwt.accessSecret', { infer: true }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register((await import('@fastify/multipart')).default as any, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1 }, // 8 MB per file
  });

  // ---------- Validation ----------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // ---------- Routing ----------
  app.setGlobalPrefix('api/v1');
  app.enableVersioning({ type: VersioningType.URI });

  // ---------- Swagger (dev only) ----------
  if (config.get('nodeEnv', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Asistencia API')
      .setDescription('Gestión de asistencia escolar — Colegio San Sebastián de Paine')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const host = config.get('api.host', { infer: true });
  const port = config.get('api.port', { infer: true });
  await app.listen(port, host);
  app.get(Logger).log(`API listening on http://${host}:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
