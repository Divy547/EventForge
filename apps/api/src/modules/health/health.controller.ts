import { Controller, Get, HttpStatus, Inject, type OnModuleInit, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { createConnection } from 'node:net';
import {
  checkDatabaseHealth,
  type DatabaseConnection,
  outboxRecords,
  sql,
  inArray,
} from '@eventforge/database';
import { defaultMetricsRegistry } from '@eventforge/common';
import { DATABASE_CONNECTION } from '../database/database.provider.js';
import { Public } from '../../common/decorators/public.decorator.js';

const dbPoolTotal = defaultMetricsRegistry.registerGauge(
  'eventforge_db_pool_total_connections',
  'Total database connection pool size',
);
const dbPoolIdle = defaultMetricsRegistry.registerGauge(
  'eventforge_db_pool_idle_connections',
  'Idle database connections in pool',
);
const dbPoolWaiting = defaultMetricsRegistry.registerGauge(
  'eventforge_db_pool_waiting_requests',
  'Requests waiting for a database connection',
);

const outboxPendingGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_outbox_pending_gauge',
  'Number of outbox records currently in PENDING status',
);
const outboxFailedGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_outbox_failed_gauge',
  'Number of outbox records currently in FAILED status',
);
const outboxDeadLetterGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_outbox_dead_letter_gauge',
  'Number of outbox records currently in DEAD_LETTER status',
);

interface CachedOutboxCounts {
  pending: number;
  failed: number;
  deadLetter: number;
}

@ApiTags('Health')
@Controller()
export class HealthController implements OnModuleInit {
  private cachedCounts: CachedOutboxCounts = { pending: 0, failed: 0, deadLetter: 0 };
  private lastFetchTime = 0;
  private inFlightFetch: Promise<CachedOutboxCounts> | null = null;
  private readonly CACHE_TTL_MS = 15000;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly conn: DatabaseConnection,
  ) {}

  onModuleInit(): void {
    dbPoolTotal.setCollector(() => this.conn.pool.totalCount);
    dbPoolIdle.setCollector(() => this.conn.pool.idleCount);
    dbPoolWaiting.setCollector(() => this.conn.pool.waitingCount);

    outboxPendingGauge.setCollector(async () => {
      const counts = await this.getCachedOutboxCounts();
      return counts.pending;
    });

    outboxFailedGauge.setCollector(async () => {
      const counts = await this.getCachedOutboxCounts();
      return counts.failed;
    });

    outboxDeadLetterGauge.setCollector(async () => {
      const counts = await this.getCachedOutboxCounts();
      return counts.deadLetter;
    });
  }

  /**
   * Retrieves aggregated outbox counts using a 15-second TTL cache with single-flight
   * query coalescing and safe error fallback.
   */
  private async getCachedOutboxCounts(): Promise<CachedOutboxCounts> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedCounts;
    }

    if (this.inFlightFetch) {
      return this.inFlightFetch;
    }

    this.inFlightFetch = (async () => {
      try {
        const rows = await this.conn.db
          .select({
            status: outboxRecords.status,
            count: sql<number>`count(*)::int`,
          })
          .from(outboxRecords)
          .where(inArray(outboxRecords.status, ['PENDING', 'FAILED', 'DEAD_LETTER']))
          .groupBy(outboxRecords.status);

        const counts: CachedOutboxCounts = { pending: 0, failed: 0, deadLetter: 0 };
        for (const row of rows) {
          if (row.status === 'PENDING') counts.pending = Number(row.count) || 0;
          else if (row.status === 'FAILED') counts.failed = Number(row.count) || 0;
          else if (row.status === 'DEAD_LETTER') counts.deadLetter = Number(row.count) || 0;
        }

        this.cachedCounts = counts;
        this.lastFetchTime = Date.now();
        return counts;
      } catch {
        // Safe fallback: return last cached counts, never crash scraper
        return this.cachedCounts;
      } finally {
        this.inFlightFetch = null;
      }
    })();

    return this.inFlightFetch;
  }

  @Public()
  @Get(['health', 'v1/health'])
  @ApiOperation({ summary: 'Liveness check' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  getLiveness(): Record<string, unknown> {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get(['ready', 'v1/ready'])
  @ApiOperation({ summary: 'Readiness check verifying database and Redis connectivity' })
  @ApiResponse({ status: 200, description: 'All dependencies are healthy and ready' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are unhealthy' })
  async getReadiness(@Res() res: Response): Promise<void> {
    const dbHealth = await checkDatabaseHealth(this.conn.pool);
    const redisHealth = await this.checkRedisHealth();

    const isReady = dbHealth.ok && redisHealth.ok;
    const statusCode = isReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    res.status(statusCode).json({
      status: isReady ? 'ready' : 'unhealthy',
      timestamp: new Date().toISOString(),
      dependencies: {
        postgres: {
          status: dbHealth.ok ? 'up' : 'down',
          latencyMs: dbHealth.latencyMs,
          error: dbHealth.error,
        },
        redis: {
          status: redisHealth.ok ? 'up' : 'down',
          latencyMs: redisHealth.latencyMs,
          error: redisHealth.error,
        },
      },
    });
  }

  @Public()
  @Get(['metrics', 'v1/metrics'])
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  @ApiResponse({ status: 200, description: 'Prometheus metrics in standard exposition format' })
  async getMetrics(@Res() res: Response): Promise<void> {
    const text = await defaultMetricsRegistry.exportPrometheusText();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(HttpStatus.OK).send(text);
  }

  private async checkRedisHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    return new Promise((resolve) => {
      try {
        const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
        const host = redisUrl.hostname || 'localhost';
        const port = parseInt(redisUrl.port, 10) || 6379;

        const socket = createConnection({ host, port, timeout: 2000 }, () => {
          socket.write('PING\r\n');
        });

        socket.on('data', (data) => {
          const response = data.toString();
          socket.destroy();
          if (response.includes('PONG')) {
            resolve({ ok: true, latencyMs: Date.now() - start });
          } else {
            resolve({
              ok: false,
              latencyMs: Date.now() - start,
              error: 'Unexpected Redis response',
            });
          }
        });

        socket.on('error', (err) => {
          socket.destroy();
          resolve({ ok: false, latencyMs: Date.now() - start, error: err.message });
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve({ ok: false, latencyMs: Date.now() - start, error: 'Connection timeout' });
        });
      } catch (err) {
        resolve({
          ok: false,
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
}
