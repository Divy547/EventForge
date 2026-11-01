import {
  Injectable,
  Inject,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { checkDatabaseHealth } from '@eventforge/database';
import { defaultMetricsRegistry } from '@eventforge/common';
import { WorkerConfigService } from '../config/worker-config.service.js';
import { WorkerDatabaseService } from '../database/worker-database.service.js';
import { REDIS_CLIENT, DELIVERY_QUEUE } from '../redis/redis.provider.js';

const queueWaitingJobsGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_queue_waiting_jobs_gauge',
  'Number of webhook delivery jobs waiting to be processed in the BullMQ queue',
);

const queueActiveJobsGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_queue_active_jobs_gauge',
  'Number of webhook delivery jobs currently being processed by BullMQ workers',
);

const queueDelayedJobsGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_queue_delayed_jobs_gauge',
  'Number of webhook delivery jobs delayed in the BullMQ queue waiting for backoff retry',
);

const queueFailedJobsGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_queue_failed_jobs_gauge',
  'Number of webhook delivery jobs that failed in the BullMQ queue',
);

@Injectable()
export class WorkerHttpServerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerHttpServerService.name);
  private server: Server | null = null;

  constructor(
    private readonly configService: WorkerConfigService,
    private readonly dbService: WorkerDatabaseService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
  ) {}

  onModuleInit(): void {
    // 1. Register dynamic BullMQ queue metrics collectors
    queueWaitingJobsGauge.setCollector(async () => {
      try {
        return await this.deliveryQueue.getWaitingCount();
      } catch {
        return 0;
      }
    });

    queueActiveJobsGauge.setCollector(async () => {
      try {
        return await this.deliveryQueue.getActiveCount();
      } catch {
        return 0;
      }
    });

    queueDelayedJobsGauge.setCollector(async () => {
      try {
        return await this.deliveryQueue.getDelayedCount();
      } catch {
        return 0;
      }
    });

    queueFailedJobsGauge.setCollector(async () => {
      try {
        return await this.deliveryQueue.getFailedCount();
      } catch {
        return 0;
      }
    });

    // 2. Start lightweight HTTP server for liveness, readiness, and Prometheus scraping
    const port = this.configService.workerPort;
    const host = this.configService.workerHost;
    if (port <= 0 || (this.configService.nodeEnv === 'test' && !process.env.WORKER_PORT)) {
      this.logger.log('Worker HTTP server disabled (WORKER_PORT <= 0 or test environment)');
      return;
    }

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.server.listen(port, host, () => {
      this.logger.log(`Worker operational HTTP server listening on ${host}:${port}`);
    });

    this.server.on('error', (err) => {
      this.logger.error(`Worker HTTP server encountered error: ${err.message}`, err.stack);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          this.logger.log('Worker HTTP server closed gracefully.');
          resolve();
        });
      });
      this.server = null;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split('?')[0] || '/';
    const method = req.method?.toUpperCase() || 'GET';

    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    if (url === '/health' || url === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'eventforge-worker',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url === '/ready' || url === '/v1/ready') {
      const dbHealth = await checkDatabaseHealth(this.dbService.pool);
      const isRedisReady = this.redisClient.status === 'ready';

      const isReady = dbHealth.ok && isRedisReady;
      const statusCode = isReady ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: isReady ? 'ready' : 'unhealthy',
          service: 'eventforge-worker',
          timestamp: new Date().toISOString(),
          dependencies: {
            postgres: {
              status: dbHealth.ok ? 'up' : 'down',
              latencyMs: dbHealth.latencyMs,
              ...(dbHealth.error ? { error: dbHealth.error } : {}),
            },
            redis: {
              status: isRedisReady ? 'up' : 'down',
            },
          },
        }),
      );
      return;
    }

    if (url === '/metrics' || url === '/v1/metrics') {
      const text = await defaultMetricsRegistry.exportPrometheusText();
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      res.end(text);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}
