import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { WorkerDatabaseService } from '../database/worker-database.service.js';
import { DELIVERY_QUEUE } from '../redis/redis.provider.js';
import { WorkerConfigService } from '../config/worker-config.service.js';

@Injectable()
export class StaleDeliveryRecoveryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StaleDeliveryRecoveryService.name);
  private recoveryTimer: NodeJS.Timeout | null = null;
  private isRecovering = false;
  private isShuttingDown = false;

  constructor(
    private readonly dbService: WorkerDatabaseService,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
    private readonly configService: WorkerConfigService,
  ) {}

  onModuleInit(): void {
    this.recoveryTimer = setInterval(() => {
      void this.recoverStaleDeliveries();
    }, this.configService.staleRecoveryIntervalMs);
    this.recoveryTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * Scans PostgreSQL for:
   * 1. Abandoned IN_FLIGHT deliveries whose worker died (synthesizes WORKER_CRASHED attempt and marks FAILED/DEAD_LETTER).
   * 2. Due FAILED retries needing re-enqueueing into BullMQ using deterministic IDs and timestamp coordination.
   */
  async recoverStaleDeliveries(): Promise<number> {
    if (this.isRecovering || this.isShuttingDown) {
      return 0;
    }

    this.isRecovering = true;

    try {
      // 1. Recover abandoned in-flight deliveries past lease timeout
      const leaseSeconds = this.configService.deliveryLeaseTimeoutSeconds;
      const recoveredCrashes =
        await this.dbService.recoverAbandonedInFlightDeliveries(leaseSeconds);

      if (recoveredCrashes.length > 0) {
        this.logger.warn({
          message: `Recovered ${recoveredCrashes.length} abandoned IN_FLIGHT delivery record(s) from worker crash/timeout`,
          count: recoveredCrashes.length,
          deliveryIds: recoveredCrashes.map((d) => d.id),
        });
      }

      // 2. Discover due retries that have not been touched within grace window (default 30s)
      const dueDeliveries = await this.dbService.findDueDeliveriesForRecovery(50, 30);

      if (dueDeliveries.length === 0) {
        return recoveredCrashes.length;
      }

      this.logger.log({
        message: `Re-enqueueing ${dueDeliveries.length} due retry delivery record(s)`,
        count: dueDeliveries.length,
        deliveryIds: dueDeliveries.map((d) => d.id),
      });

      for (const delivery of dueDeliveries) {
        try {
          // Deterministic attempt-based job identity prevents job multiplication
          const targetAttempt = delivery.attemptsCount + 1;
          const jobId = `delivery-${delivery.id}-${targetAttempt}`;

          await this.deliveryQueue.add('deliver', { deliveryId: delivery.id }, { jobId });

          // Update updatedAt to prevent duplicate selection while waiting in Redis
          await this.dbService.touchDeliveryRecoveryTimestamp(delivery.id);
        } catch (enqueueErr) {
          this.logger.error(
            `Failed to re-enqueue due delivery ${delivery.id}: ${enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr)}`,
          );
        }
      }

      return recoveredCrashes.length + dueDeliveries.length;
    } catch (err) {
      this.logger.error(
        `Failed checking for stale deliveries: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    } finally {
      this.isRecovering = false;
    }
  }
}
