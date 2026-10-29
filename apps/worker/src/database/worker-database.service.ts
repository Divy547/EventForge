import { Inject, Injectable } from '@nestjs/common';
import {
  type Database,
  type OutboxRecord,
  type DeliveryRecord,
  type EventRecord,
  type SubscriptionRecord,
  type CreateDeliveriesInput,
  type DeliveryContext,
  type RecordSuccessParams,
  type RecordFailureParams,
  type StaleDeliveriesOptions,
  type ClaimOutboxOptions,
  type ClaimDeliveryOptions,
  claimPendingOutboxRecords,
  completeOutboxRecord,
  failOutboxRecord,
  createDeliveriesForEvent,
  getDeliveryContext,
  claimDeliveryForProcessing,
  recordSuccessfulDelivery,
  recordFailedDelivery,
  recordDeliveryAborted,
  recoverAbandonedInFlightDeliveries,
  findDueDeliveriesForRecovery,
  touchDeliveryRecoveryTimestamp,
  findStaleDeliveries,
  events,
  subscriptions,
  eq,
  and,
  type DatabaseConnection,
} from '@eventforge/database';
import { DATABASE, DATABASE_CONNECTION } from './database.provider.js';

@Injectable()
export class WorkerDatabaseService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection,
  ) {}

  get database(): Database {
    return this.db;
  }

  get pool(): DatabaseConnection['pool'] {
    return this.conn.pool;
  }

  async claimPendingOutboxRecords(options: ClaimOutboxOptions): Promise<OutboxRecord[]> {
    return claimPendingOutboxRecords(this.db, options);
  }

  async completeOutboxRecord(outboxId: string): Promise<void> {
    return completeOutboxRecord(this.db, outboxId);
  }

  async failOutboxRecord(outboxId: string, errorMessage: string): Promise<void> {
    return failOutboxRecord(this.db, outboxId, errorMessage);
  }

  async getEvent(eventId: string): Promise<EventRecord | null> {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId)).limit(1);

    return event || null;
  }

  async getActiveSubscriptions(projectId: string): Promise<SubscriptionRecord[]> {
    return await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.projectId, projectId), eq(subscriptions.isActive, true)));
  }

  async createDeliveriesForEvent(input: CreateDeliveriesInput): Promise<DeliveryRecord[]> {
    return createDeliveriesForEvent(this.db, input);
  }

  async claimDeliveryForProcessing(
    deliveryId: string,
    options?: ClaimDeliveryOptions,
  ): Promise<DeliveryRecord | null> {
    return claimDeliveryForProcessing(this.db, deliveryId, options);
  }

  async getDeliveryContext(deliveryId: string): Promise<DeliveryContext | null> {
    return getDeliveryContext(this.db, deliveryId);
  }

  async recordSuccessfulDelivery(params: RecordSuccessParams): Promise<void> {
    return recordSuccessfulDelivery(this.db, params);
  }

  async recordFailedDelivery(params: RecordFailureParams): Promise<void> {
    return recordFailedDelivery(this.db, params);
  }

  async recordDeliveryAborted(deliveryId: string): Promise<void> {
    return recordDeliveryAborted(this.db, deliveryId);
  }

  async recoverAbandonedInFlightDeliveries(
    leaseTimeoutSeconds?: number,
  ): Promise<DeliveryRecord[]> {
    return recoverAbandonedInFlightDeliveries(this.db, leaseTimeoutSeconds);
  }

  async findDueDeliveriesForRecovery(
    limit?: number,
    graceSeconds?: number,
  ): Promise<DeliveryRecord[]> {
    return findDueDeliveriesForRecovery(this.db, limit, graceSeconds);
  }

  async touchDeliveryRecoveryTimestamp(deliveryId: string): Promise<void> {
    return touchDeliveryRecoveryTimestamp(this.db, deliveryId);
  }

  async findStaleDeliveries(options?: StaleDeliveriesOptions): Promise<DeliveryRecord[]> {
    return findStaleDeliveries(this.db, options);
  }
}
