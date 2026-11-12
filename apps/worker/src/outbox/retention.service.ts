import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { defaultMetricsRegistry } from '@eventforge/common';
import { WorkerDatabaseService } from '../database/worker-database.service.js';
import { WorkerConfigService } from '../config/worker-config.service.js';

const retentionDeletedTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_retention_deleted_total',
  'Total records deleted by the data retention job',
  ['table'],
);

/**
 * Periodically deletes completed deliveries (and their attempts) and fully processed events
 * older than RETENTION_DAYS. Unfinished work (PENDING, IN_FLIGHT, FAILED, DEAD_LETTER
 * deliveries) and events not yet fanned out are never deleted; see `purgeExpiredRecords`.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isShuttingDown = false;

  constructor(
    private readonly dbService: WorkerDatabaseService,
    private readonly configService: WorkerConfigService,
  ) {}

  onModuleInit(): void {
    if (this.configService.retentionDays <= 0) {
      this.logger.log('Data retention disabled (RETENTION_DAYS=0)');
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.configService.retentionIntervalMs);
    this.timer.unref();
    this.logger.log(
      `Data retention enabled: keeping ${this.configService.retentionDays} day(s), running every ${this.configService.retentionIntervalMs}ms`,
    );
  }

  onApplicationShutdown(): void {
    this.isShuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Runs one retention pass. Returns the number of rows deleted (0 if skipped or failed). */
  async runOnce(now: Date = new Date()): Promise<number> {
    const days = this.configService.retentionDays;
    if (days <= 0 || this.isRunning || this.isShuttingDown) {
      return 0;
    }
    this.isRunning = true;
    try {
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const result = await this.dbService.purgeExpiredRecords({
        cutoff,
        batchSize: this.configService.retentionBatchSize,
      });
      if (result.deliveries > 0) {
        retentionDeletedTotal.inc({ table: 'deliveries' }, result.deliveries);
      }
      if (result.events > 0) {
        retentionDeletedTotal.inc({ table: 'events' }, result.events);
      }
      if (result.deliveries + result.events > 0) {
        this.logger.log({
          message: `Retention deleted ${result.deliveries} deliveries and ${result.events} events older than ${days} day(s)`,
          cutoff: cutoff.toISOString(),
          ...result,
        });
      }
      return result.deliveries + result.events;
    } catch (err) {
      this.logger.error(
        `Retention run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    } finally {
      this.isRunning = false;
    }
  }
}
