import { Injectable } from '@nestjs/common';
import { validateEnv, type EnvConfig } from '@eventforge/config';

@Injectable()
export class WorkerConfigService {
  private readonly config: EnvConfig;

  constructor() {
    this.config = validateEnv();
  }

  get nodeEnv(): string {
    return this.config.NODE_ENV;
  }

  get logLevel(): string {
    return this.config.LOG_LEVEL;
  }

  get databaseUrl(): string {
    return this.config.DATABASE_URL;
  }

  get databaseMaxConnections(): number {
    return this.config.DATABASE_MAX_CONNECTIONS;
  }

  get redisUrl(): string {
    return this.config.REDIS_URL;
  }

  get outboxPollIntervalMs(): number {
    return this.config.OUTBOX_POLL_INTERVAL_MS;
  }

  get outboxBatchSize(): number {
    return this.config.OUTBOX_BATCH_SIZE;
  }

  get outboxLockTimeoutMs(): number {
    return this.config.OUTBOX_LOCK_TIMEOUT_MS;
  }

  get workerConcurrency(): number {
    return this.config.WORKER_CONCURRENCY;
  }

  get workerPort(): number {
    return this.config.WORKER_PORT;
  }

  get webhookTimeoutMs(): number {
    return this.config.WEBHOOK_TIMEOUT_MS;
  }

  get webhookMaxRetries(): number {
    return this.config.WEBHOOK_MAX_RETRIES;
  }

  get allowLocalWebhooks(): boolean {
    return this.config.ALLOW_LOCAL_WEBHOOKS;
  }

  /**
   * Lease timeout for in-flight deliveries. Always guaranteed to exceed WEBHOOK_TIMEOUT_MS by at least 30s.
   */
  get deliveryLeaseTimeoutMs(): number {
    return Math.max(this.config.DELIVERY_LEASE_TIMEOUT_MS, this.config.WEBHOOK_TIMEOUT_MS + 30000);
  }

  get deliveryLeaseTimeoutSeconds(): number {
    return Math.ceil(this.deliveryLeaseTimeoutMs / 1000);
  }

  get staleRecoveryIntervalMs(): number {
    return this.config.STALE_RECOVERY_INTERVAL_MS;
  }
}
