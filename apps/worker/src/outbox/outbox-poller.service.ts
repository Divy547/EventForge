import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { matchesEventType, defaultMetricsRegistry } from '@eventforge/common';
import { WorkerDatabaseService } from '../database/worker-database.service.js';
import { DELIVERY_QUEUE } from '../redis/redis.provider.js';
import { WorkerConfigService } from '../config/worker-config.service.js';

const outboxDeadLetterTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_outbox_dead_letter_total',
  'Total number of outbox records permanently moved to DEAD_LETTER',
  ['reason'],
);

@Injectable()
export class OutboxPollerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPollerService.name);
  private readonly workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private isShuttingDown = false;

  constructor(
    private readonly dbService: WorkerDatabaseService,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
    private readonly configService: WorkerConfigService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      `Starting outbox poller with worker ID: ${this.workerId}, interval: ${this.configService.outboxPollIntervalMs}ms`,
    );

    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.configService.outboxPollIntervalMs);
    this.pollTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for in-flight polling cycle to complete
    let waitCount = 0;
    while (this.isPolling && waitCount < 30) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      waitCount++;
    }

    this.logger.log('Outbox poller stopped gracefully.');
  }

  /**
   * Performs a single outbox polling execution:
   * 1. Safely claims pending outbox records with FOR UPDATE SKIP LOCKED.
   * 2. Matches event types against active tenant subscriptions.
   * 3. Idempotently creates delivery rows in PostgreSQL.
   * 4. Enqueues delivery jobs to Redis/BullMQ (outside DB transactions).
   * 5. Marks outbox records PROCESSED.
   */
  async pollOnce(): Promise<number> {
    if (this.isPolling || this.isShuttingDown) {
      return 0;
    }

    this.isPolling = true;

    try {
      const records = await this.dbService.claimPendingOutboxRecords({
        claimedBy: this.workerId,
        batchSize: this.configService.outboxBatchSize,
        claimTimeoutMinutes: 5,
        maxAttempts: 10,
      });

      if (records.length === 0) {
        return 0;
      }

      this.logger.log({
        message: `Claimed ${records.length} outbox record(s) for processing`,
        batchSize: records.length,
        recordIds: records.map((r) => r.id),
      });

      for (const record of records) {
        try {
          await this.processOutboxRecord(record.id, record.eventId);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.logger.error({
            message: `Failed to process outbox record ${record.id} for event ${record.eventId}: ${errMsg}`,
            recordId: record.id,
            eventId: record.eventId,
            error: errMsg,
            stack: error instanceof Error ? error.stack : undefined,
          });
          const result = await this.dbService.recordFailedOutboxAttempt(record.id, errMsg, 10);
          if (result.status === 'DEAD_LETTER') {
            outboxDeadLetterTotal.inc({ reason: 'max_attempts_exceeded' });
            this.logger.error({
              message: `Outbox record ${record.id} permanently transitioned to DEAD_LETTER after ${result.attempts} attempts`,
              recordId: record.id,
              eventId: record.eventId,
              attempts: result.attempts,
            });
          }
        }
      }

      return records.length;
    } catch (error) {
      this.logger.error(
        `Error claiming outbox records: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.isPolling = false;
    }
  }

  private async processOutboxRecord(outboxId: string, eventId: string): Promise<void> {
    // 1. Fetch event
    const event = await this.dbService.getEvent(eventId);

    if (!event) {
      const result = await this.dbService.recordFailedOutboxAttempt(
        outboxId,
        `Event ${eventId} not found`,
        10,
      );
      if (result.status === 'DEAD_LETTER') {
        outboxDeadLetterTotal.inc({ reason: 'event_not_found' });
      }
      return;
    }

    // 2. Fetch active subscriptions for this project
    const activeSubscriptions = await this.dbService.getActiveSubscriptions(event.projectId);

    // 3. Match subscriptions based on event type patterns
    const matchingSubs = activeSubscriptions.filter((sub) => {
      const patterns = Array.isArray(sub.eventTypes) ? (sub.eventTypes as string[]) : [];
      return patterns.some((pattern: string) => matchesEventType(pattern, event.eventType));
    });

    if (matchingSubs.length > 0) {
      // 4. Atomically create deliveries in PostgreSQL (ON CONFLICT DO NOTHING)
      const deliveryRecords = await this.dbService.createDeliveriesForEvent({
        projectId: event.projectId,
        eventId: event.id,
        subscriptionIds: matchingSubs.map((s) => s.id),
      });

      // 5. Enqueue BullMQ jobs for each delivery outside of DB transactions
      const traceContext = {
        traceparent:
          typeof event.metadata === 'object' &&
          event.metadata !== null &&
          'traceparent' in event.metadata
            ? String((event.metadata as Record<string, unknown>).traceparent)
            : undefined,
        tracestate:
          typeof event.metadata === 'object' &&
          event.metadata !== null &&
          'tracestate' in event.metadata
            ? String((event.metadata as Record<string, unknown>).tracestate)
            : undefined,
      };

      for (const delivery of deliveryRecords) {
        await this.deliveryQueue.add(
          'deliver',
          {
            deliveryId: delivery.id,
            traceparent: traceContext.traceparent,
            tracestate: traceContext.tracestate,
          },
          {
            jobId: `delivery-${delivery.id}-${delivery.attemptsCount + 1}`,
          },
        );
      }

      this.logger.log({
        message: `Fan-out completed for event ${event.id}: created ${deliveryRecords.length} delivery jobs`,
        eventId: event.id,
        eventType: event.eventType,
        projectId: event.projectId,
        deliveryJobsCount: deliveryRecords.length,
      });
    } else {
      this.logger.log({
        message: `No matching active subscriptions for event ${event.id} (${event.eventType})`,
        eventId: event.id,
        eventType: event.eventType,
        projectId: event.projectId,
        deliveryJobsCount: 0,
      });
    }

    // 6. Complete outbox record
    await this.dbService.completeOutboxRecord(outboxId);
  }
}
