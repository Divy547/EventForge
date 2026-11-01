import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  WEBHOOK_DELIVERY_QUEUE,
  calculateExponentialBackoff,
  defaultMetricsRegistry,
  createChildTraceparent,
} from '@eventforge/common';
import { WorkerDatabaseService } from '../database/worker-database.service.js';
import { DELIVERY_QUEUE, REDIS_CLIENT } from '../redis/redis.provider.js';
import { WorkerConfigService } from '../config/worker-config.service.js';
import { HttpDispatcherService, WebhookDispatchError } from './http-dispatcher.service.js';

export interface WebhookJobData {
  deliveryId: string;
  traceparent?: string | undefined;
  tracestate?: string | undefined;
}

const inFlightDeliveriesGauge = defaultMetricsRegistry.registerGauge(
  'eventforge_deliveries_in_flight_gauge',
  'Number of webhook deliveries currently in flight (claimed by workers)',
);

const deliveryAttemptsTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_delivery_attempts_total',
  'Total number of webhook HTTP delivery attempts dispatched to external endpoints',
  ['status_code_class', 'error_code'],
);

const deliveriesSuccessTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_deliveries_success_total',
  'Total number of webhook deliveries successfully delivered to target endpoints',
);

const deliveriesFailedTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_deliveries_failed_total',
  'Total number of failed webhook delivery attempts',
  ['error_code', 'retryable'],
);

const deliveriesRetriesTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_deliveries_retries_total',
  'Total number of delivery retry jobs scheduled into BullMQ',
  ['attempt_number'],
);

const deliveriesDeadLetterTotal = defaultMetricsRegistry.registerCounter(
  'eventforge_deliveries_dead_letter_total',
  'Total number of deliveries transitioned to dead letter status',
  ['reason'],
);

const webhookDurationSeconds = defaultMetricsRegistry.registerHistogram(
  'eventforge_webhook_duration_seconds',
  'Webhook dispatch HTTP response latency in seconds',
  [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
);

@Injectable()
export class DeliveryProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DeliveryProcessor.name);
  private worker: Worker<WebhookJobData> | null = null;

  constructor(
    private readonly dbService: WorkerDatabaseService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
    private readonly configService: WorkerConfigService,
    private readonly httpDispatcher: HttpDispatcherService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<WebhookJobData>(
      WEBHOOK_DELIVERY_QUEUE,
      async (job: Job<WebhookJobData>) => {
        await this.processDelivery(job.data.deliveryId, {
          traceparent: job.data.traceparent,
          tracestate: job.data.tracestate,
        });
      },
      {
        connection: this.redisClient,
        concurrency: this.configService.workerConcurrency,
      },
    );

    this.worker.on('error', (err) => {
      this.logger.error(`BullMQ Worker encountered error: ${err.message}`, err.stack);
    });

    this.logger.log(
      `Delivery processor initialized on queue '${WEBHOOK_DELIVERY_QUEUE}' with concurrency ${this.configService.workerConcurrency}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      this.logger.log('Closing delivery processor worker...');
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Processes a single delivery job: claims delivery, constructs signed payload,
   * dispatches HTTP call, handles retry / dead-lettering, and records attempt history.
   */
  async processDelivery(
    deliveryId: string,
    traceContext?: { traceparent?: string | undefined; tracestate?: string | undefined },
  ): Promise<void> {
    // 1. Atomically claim delivery in DB (moves status to IN_FLIGHT, enforcing backoff and max attempts)
    const claimedDelivery = await this.dbService.claimDeliveryForProcessing(deliveryId, {
      leaseTimeoutSeconds: this.configService.deliveryLeaseTimeoutSeconds,
    });

    if (!claimedDelivery) {
      this.logger.debug(
        `Delivery ${deliveryId} is not in a claimable state (already completed, dead-lettered, backoff not due, or active)`,
      );
      return;
    }

    inFlightDeliveriesGauge.inc();

    try {
      // 2. Fetch delivery context (delivery, event, subscription)
      const context = await this.dbService.getDeliveryContext(deliveryId);
      if (!context) {
        this.logger.error(`Context not found for claimed delivery ${deliveryId}`);
        return;
      }

      const { event, subscription } = context;

      // 3. Pre-flight check: inactive subscriptions do not count as HTTP attempts
      if (!subscription.isActive) {
        deliveriesDeadLetterTotal.inc({ reason: 'subscription_inactive' });
        this.logger.warn({
          message: `Subscription ${subscription.id} is inactive, abandoning delivery ${deliveryId}`,
          deliveryId,
          subscriptionId: subscription.id,
          eventId: event.id,
        });
        await this.dbService.recordDeliveryAborted(deliveryId);
        return;
      }

      // 4. Construct payload envelope
      const envelope = {
        id: event.id,
        event: event.eventType,
        source: event.source,
        timestamp: event.createdAt.toISOString(),
        data: event.payload,
      };
      const payloadString = JSON.stringify(envelope);

      // Actual HTTP transmission attempt number
      const attemptNumber = claimedDelivery.attemptsCount + 1;

      this.logger.log({
        message: `Processing delivery ${deliveryId} (attempt ${attemptNumber})`,
        deliveryId,
        eventId: event.id,
        subscriptionId: subscription.id,
        attemptNumber,
      });

      // Derive trace context: from job data or event metadata
      const parentTraceparent =
        traceContext?.traceparent ||
        (typeof event.metadata === 'object' &&
        event.metadata !== null &&
        'traceparent' in event.metadata
          ? String((event.metadata as Record<string, unknown>).traceparent)
          : undefined);
      const tracestate =
        traceContext?.tracestate ||
        (typeof event.metadata === 'object' &&
        event.metadata !== null &&
        'tracestate' in event.metadata
          ? String((event.metadata as Record<string, unknown>).tracestate)
          : undefined);

      const outboundTraceparent = createChildTraceparent(parentTraceparent);

      // 5. Dispatch webhook
      try {
        const response = await this.httpDispatcher.dispatch({
          targetUrl: subscription.targetUrl,
          payloadString,
          signingSecret: subscription.signingSecret,
          deliveryId: claimedDelivery.id,
          eventId: event.id,
          customHeaders: subscription.headers,
          traceparent: outboundTraceparent,
          tracestate,
        });

        // 6. Success: record COMPLETED status, increment attempt count, and save attempt history
        await this.dbService.recordSuccessfulDelivery({
          deliveryId: claimedDelivery.id,
          attemptNumber,
          statusCode: response.statusCode,
          responseHeaders: response.headers,
          responseBodySnippet: response.bodySnippet,
          executionDurationMs: response.durationMs,
        });

        const statusCodeClass = `${Math.floor(response.statusCode / 100)}xx`;
        deliveryAttemptsTotal.inc({ status_code_class: statusCodeClass, error_code: 'NONE' });
        deliveriesSuccessTotal.inc();
        webhookDurationSeconds.observe(response.durationMs / 1000);

        this.logger.log({
          message: `Delivery ${deliveryId} successfully completed (attempt ${attemptNumber}, status ${response.statusCode})`,
          deliveryId,
          eventId: event.id,
          subscriptionId: subscription.id,
          attemptNumber,
          statusCode: response.statusCode,
          durationMs: response.durationMs,
        });
      } catch (err: unknown) {
        await this.handleDeliveryError(deliveryId, attemptNumber, claimedDelivery.maxAttempts, err);
      }
    } finally {
      inFlightDeliveriesGauge.dec();
    }
  }

  /**
   * Evaluates dispatch error, classifies retryability, calculates backoff delay,
   * updates delivery state in DB, and re-enqueues or dead-letters the delivery.
   */
  private async handleDeliveryError(
    deliveryId: string,
    attemptNumber: number,
    maxAttempts: number,
    err: unknown,
  ): Promise<void> {
    let statusCode: number | null = null;
    let headers: Record<string, string> | null = null;
    let bodySnippet: string | null = null;
    let durationMs = 0;
    let errorCode = 'UNKNOWN_ERROR';
    let errorMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof WebhookDispatchError) {
      statusCode = err.statusCode;
      headers = err.headers;
      bodySnippet = err.bodySnippet;
      durationMs = err.durationMs;
      errorCode = err.errorCode;
      errorMessage = err.message;
    }

    if (durationMs > 0) {
      webhookDurationSeconds.observe(durationMs / 1000);
    }

    // Classify retryability
    let isRetryable = false;

    if (
      errorCode === 'SSRF_BLOCKED' ||
      errorCode === 'INVALID_URL' ||
      errorCode === 'UNSUPPORTED_PROTOCOL'
    ) {
      isRetryable = false;
    } else if (statusCode === 429) {
      isRetryable = true;
    } else if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
      isRetryable = false; // 4xx client errors are permanent
    } else if (statusCode !== null && statusCode >= 500) {
      isRetryable = true; // 5xx server errors are transient
    } else if (
      errorCode === 'TIMEOUT' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ECONNRESET' ||
      errorCode === 'ENOTFOUND' ||
      errorCode === 'NETWORK_ERROR'
    ) {
      isRetryable = true; // Network timeouts and transient transport errors are retryable
    }

    const retriesExhausted = attemptNumber >= maxAttempts;
    if (retriesExhausted) {
      isRetryable = false;
    }

    const statusCodeClass = statusCode ? `${Math.floor(statusCode / 100)}xx` : 'none';
    deliveryAttemptsTotal.inc({ status_code_class: statusCodeClass, error_code: errorCode });

    if (isRetryable) {
      const delayMs = this.calculateRetryDelay(attemptNumber, headers);
      const nextRetryAt = new Date(Date.now() + delayMs);

      await this.dbService.recordFailedDelivery({
        deliveryId,
        attemptNumber,
        statusCode,
        responseHeaders: headers,
        responseBodySnippet: bodySnippet,
        executionDurationMs: durationMs,
        errorCode,
        errorMessage,
        isRetryable: true,
        nextRetryAt,
      });

      // Schedule delayed BullMQ retry job with deterministic attempt-based ID
      await this.deliveryQueue.add(
        'deliver',
        { deliveryId },
        {
          delay: delayMs,
          jobId: `delivery-${deliveryId}-${attemptNumber + 1}`,
        },
      );

      deliveriesFailedTotal.inc({ error_code: errorCode, retryable: 'true' });
      deliveriesRetriesTotal.inc({ attempt_number: String(attemptNumber) });

      this.logger.warn({
        message: `Delivery ${deliveryId} failed attempt ${attemptNumber}/${maxAttempts} (${errorCode}). Retrying in ${delayMs}ms.`,
        deliveryId,
        attemptNumber,
        maxAttempts,
        errorCode,
        statusCode,
        delayMs,
        nextRetryAt: nextRetryAt.toISOString(),
        error: errorMessage,
      });
    } else {
      await this.dbService.recordFailedDelivery({
        deliveryId,
        attemptNumber,
        statusCode,
        responseHeaders: headers,
        responseBodySnippet: bodySnippet,
        executionDurationMs: durationMs,
        errorCode,
        errorMessage,
        isRetryable: false,
      });

      const deadLetterReason = retriesExhausted ? 'max_attempts_exceeded' : errorCode;
      deliveriesFailedTotal.inc({ error_code: errorCode, retryable: 'false' });
      deliveriesDeadLetterTotal.inc({ reason: deadLetterReason });

      this.logger.error({
        message: `Delivery ${deliveryId} permanently failed and moved to DEAD_LETTER (attempt ${attemptNumber}/${maxAttempts}, code: ${errorCode}, status: ${statusCode})`,
        deliveryId,
        attemptNumber,
        maxAttempts,
        errorCode,
        statusCode,
        reason: deadLetterReason,
        error: errorMessage,
      });
    }
  }

  /**
   * Computes backoff delay using Retry-After header if present, or jittered exponential backoff.
   */
  private calculateRetryDelay(
    attemptNumber: number,
    headers: Record<string, string> | null,
  ): number {
    const retryAfter = headers ? headers['retry-after'] || headers['Retry-After'] : null;

    if (retryAfter) {
      const parsedSeconds = parseInt(retryAfter, 10);
      if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
        return Math.min(86_400_000, Math.max(1000, parsedSeconds * 1000));
      }

      const parsedDate = new Date(retryAfter).getTime();
      if (!Number.isNaN(parsedDate)) {
        const delta = parsedDate - Date.now();
        if (delta > 0) {
          return Math.min(86_400_000, Math.max(1000, delta));
        }
      }
    }

    return calculateExponentialBackoff(attemptNumber, 1000, 86_400_000, true);
  }
}
