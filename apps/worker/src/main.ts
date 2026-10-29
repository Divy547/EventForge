import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { StructuredLogger, type LogLevel } from '@eventforge/common';
import { WorkerModule } from './worker.module.js';
import { WorkerConfigService } from './config/worker-config.service.js';

async function bootstrap() {
  const structuredLogger = new StructuredLogger({
    service: 'eventforge-worker',
    environment: process.env.NODE_ENV,
    logLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
  });

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: structuredLogger,
  });

  app.enableShutdownHooks();

  const configService = app.get(WorkerConfigService);
  const logger = new Logger('WorkerBootstrap');

  logger.log({
    message: 'EventForge Background Worker started successfully',
    pid: process.pid,
    nodeVersion: process.version,
    environment: configService.nodeEnv,
    concurrency: configService.workerConcurrency,
    pollIntervalMs: configService.outboxPollIntervalMs,
    workerPort: configService.workerPort,
  });
}

bootstrap().catch((err) => {
  console.error('Fatal worker startup error:', err);
  process.exit(1);
});
