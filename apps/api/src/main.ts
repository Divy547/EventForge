import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { validateEnv } from '@eventforge/config';
import { StructuredLogger, type LogLevel } from '@eventforge/common';
import { AppModule } from './app.module.js';

// Load environment variables before validation
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function bootstrap(): Promise<void> {
  // 1. Fail-fast environment validation
  const env = validateEnv();

  // 2. Structured Logger
  const structuredLogger = new StructuredLogger({
    service: 'eventforge-api',
    environment: env.NODE_ENV,
    logLevel: env.LOG_LEVEL as LogLevel,
  });

  const logger = new Logger('Bootstrap');

  // 3. Initialize NestJS application
  const app = await NestFactory.create(AppModule, {
    logger: structuredLogger,
    bufferLogs: true,
  });

  // 3. Graceful shutdown hooks
  app.enableShutdownHooks();

  // 4. Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // 5. OpenAPI / Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('EventForge API')
    .setDescription(
      'EventForge is a production-grade, reliable event ingestion and webhook delivery platform API.',
    )
    .setVersion('1.0.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'Tenant API Key for project-scoped authentication',
      },
      'ApiKeyAuth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'EventForge API Documentation',
  });

  // 6. Start HTTP server
  await app.listen(env.PORT);
  logger.log(`EventForge API server running on http://localhost:${env.PORT}`);
  logger.log(`OpenAPI documentation available at http://localhost:${env.PORT}/docs`);
}

bootstrap().catch((err) => {
  console.error('[Fatal Error] Failed to bootstrap EventForge API:', err);
  process.exit(1);
});
