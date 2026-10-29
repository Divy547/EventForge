import { sql, eq, and, or, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../client.js';
import { deliveries, type DeliveryRecord, type NewDeliveryRecord } from '../schema/deliveries.js';
import { deliveryAttempts, type NewDeliveryAttemptRecord } from '../schema/delivery-attempts.js';
import { events, type EventRecord } from '../schema/events.js';
import { subscriptions, type SubscriptionRecord } from '../schema/subscriptions.js';

export interface CreateDeliveriesInput {
  projectId: string;
  eventId: string;
  subscriptionIds: string[];
}

/**
 * Creates delivery records for an event and a list of target subscriptions.
 * Uses ON CONFLICT DO NOTHING to guarantee idempotency and prevent duplicate delivery entries.
 */
export async function createDeliveriesForEvent(
  db: Database,
  input: CreateDeliveriesInput,
): Promise<DeliveryRecord[]> {
  if (input.subscriptionIds.length === 0) {
    return [];
  }

  const values: NewDeliveryRecord[] = input.subscriptionIds.map((subId) => ({
    projectId: input.projectId,
    eventId: input.eventId,
    subscriptionId: subId,
    status: 'PENDING',
    attemptsCount: 0,
    maxAttempts: 5,
  }));

  // Perform bulk insert ignoring existing (eventId, subscriptionId) pairs
  await db
    .insert(deliveries)
    .values(values)
    .onConflictDoNothing({
      target: [deliveries.eventId, deliveries.subscriptionId],
    });

  // Return all delivery records matching this event and subscription list
  return await db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.eventId, input.eventId),
        inArray(deliveries.subscriptionId, input.subscriptionIds),
      ),
    );
}

export interface DeliveryContext {
  delivery: DeliveryRecord;
  event: EventRecord;
  subscription: SubscriptionRecord;
}

/**
 * Loads delivery, event, and subscription details required to execute a webhook call.
 */
export async function getDeliveryContext(
  db: Database,
  deliveryId: string,
): Promise<DeliveryContext | null> {
  const [delivery] = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!delivery) {
    return null;
  }

  const [event] = await db.select().from(events).where(eq(events.id, delivery.eventId)).limit(1);

  if (!event) {
    return null;
  }

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, delivery.subscriptionId))
    .limit(1);

  if (!subscription) {
    return null;
  }

  return { delivery, event, subscription };
}

export interface ClaimDeliveryOptions {
  leaseTimeoutSeconds?: number;
}

/**
 * Claims a delivery for processing by moving its status to IN_FLIGHT.
 * Enforces:
 * - Backoff schedule: FAILED deliveries cannot be claimed until next_retry_at is due.
 * - Maximum attempts: If attemptsCount >= maxAttempts, transitions to DEAD_LETTER and returns null.
 * - Lease timeout: IN_FLIGHT deliveries can only be reclaimed if older than leaseTimeoutSeconds.
 */
export async function claimDeliveryForProcessing(
  db: Database,
  deliveryId: string,
  options?: ClaimDeliveryOptions,
): Promise<DeliveryRecord | null> {
  const leaseSeconds = options?.leaseTimeoutSeconds ?? 60;

  return await db.transaction(async (tx) => {
    // 1. Transition any delivery that has reached or exceeded maxAttempts to DEAD_LETTER
    const [exhausted] = await tx
      .update(deliveries)
      .set({
        status: 'DEAD_LETTER',
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deliveries.id, deliveryId),
          sql`${deliveries.attemptsCount} >= ${deliveries.maxAttempts}`,
          sql`${deliveries.status} NOT IN ('COMPLETED', 'DEAD_LETTER')`,
        ),
      )
      .returning();

    if (exhausted) {
      return null;
    }

    // 2. Atomically claim eligible delivery for processing
    const [claimed] = await tx
      .update(deliveries)
      .set({
        status: 'IN_FLIGHT',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deliveries.id, deliveryId),
          sql`${deliveries.attemptsCount} < ${deliveries.maxAttempts}`,
          or(
            eq(deliveries.status, 'PENDING'),
            and(
              eq(deliveries.status, 'FAILED'),
              or(isNull(deliveries.nextRetryAt), sql`${deliveries.nextRetryAt} <= NOW()`),
            ),
            and(
              eq(deliveries.status, 'IN_FLIGHT'),
              sql`${deliveries.updatedAt} < NOW() - (${leaseSeconds} * INTERVAL '1 second')`,
            ),
          ),
        ),
      )
      .returning();

    return claimed || null;
  });
}

export interface RecordSuccessParams {
  deliveryId: string;
  attemptNumber: number;
  statusCode: number;
  responseHeaders?: Record<string, string> | null | undefined;
  responseBodySnippet?: string | null | undefined;
  executionDurationMs: number;
}

/**
 * Records a successful webhook delivery attempt and marks the parent delivery as COMPLETED.
 * Increments attemptsCount to reflect the successful execution.
 */
export async function recordSuccessfulDelivery(
  db: Database,
  params: RecordSuccessParams,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(deliveries)
      .set({
        status: 'COMPLETED',
        attemptsCount: sql`${deliveries.attemptsCount} + 1`,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, params.deliveryId));

    const attemptData: NewDeliveryAttemptRecord = {
      deliveryId: params.deliveryId,
      attemptNumber: params.attemptNumber,
      statusCode: params.statusCode,
      responseHeaders: params.responseHeaders ?? null,
      responseBodySnippet: params.responseBodySnippet ?? null,
      executionDurationMs: params.executionDurationMs,
      errorCode: null,
      errorMessage: null,
    };

    await tx.insert(deliveryAttempts).values(attemptData);
  });
}

export interface RecordFailureParams {
  deliveryId: string;
  attemptNumber: number;
  statusCode?: number | null | undefined;
  responseHeaders?: Record<string, string> | null | undefined;
  responseBodySnippet?: string | null | undefined;
  executionDurationMs: number;
  errorCode?: string | null | undefined;
  errorMessage?: string | null | undefined;
  isRetryable: boolean;
  nextRetryAt?: Date | null | undefined;
}

/**
 * Records a failed delivery attempt and sets delivery status to FAILED (if retryable)
 * or DEAD_LETTER (if non-retryable or retries exhausted).
 * Increments attemptsCount to reflect the executed attempt.
 */
export async function recordFailedDelivery(
  db: Database,
  params: RecordFailureParams,
): Promise<void> {
  const nextStatus = params.isRetryable ? 'FAILED' : 'DEAD_LETTER';

  await db.transaction(async (tx) => {
    await tx
      .update(deliveries)
      .set({
        status: nextStatus,
        attemptsCount: sql`${deliveries.attemptsCount} + 1`,
        nextRetryAt: params.isRetryable ? params.nextRetryAt : null,
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, params.deliveryId));

    const attemptData: NewDeliveryAttemptRecord = {
      deliveryId: params.deliveryId,
      attemptNumber: params.attemptNumber,
      statusCode: params.statusCode ?? null,
      responseHeaders: params.responseHeaders ?? null,
      responseBodySnippet: params.responseBodySnippet ?? null,
      executionDurationMs: params.executionDurationMs,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
    };

    await tx.insert(deliveryAttempts).values(attemptData);
  });
}

/**
 * Aborts a delivery without counting an HTTP attempt (e.g. disabled subscription or pre-flight validation failure).
 * Transitions status directly to DEAD_LETTER without incrementing attemptsCount or polluting deliveryAttempts.
 */
export async function recordDeliveryAborted(db: Database, deliveryId: string): Promise<void> {
  await db
    .update(deliveries)
    .set({
      status: 'DEAD_LETTER',
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(eq(deliveries.id, deliveryId));
}

/**
 * Recovers abandoned IN_FLIGHT deliveries whose worker crashed or timed out past leaseTimeoutSeconds.
 * Synthesizes a WORKER_CRASHED attempt in delivery_attempts, increments attemptsCount, and
 * transitions delivery to FAILED (ready for retry) or DEAD_LETTER if maxAttempts reached.
 */
export async function recoverAbandonedInFlightDeliveries(
  db: Database,
  leaseTimeoutSeconds = 60,
): Promise<DeliveryRecord[]> {
  const abandoned = await db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, 'IN_FLIGHT'),
        sql`${deliveries.updatedAt} < NOW() - (${leaseTimeoutSeconds} * INTERVAL '1 second')`,
      ),
    )
    .limit(50);

  const recovered: DeliveryRecord[] = [];

  for (const delivery of abandoned) {
    await db.transaction(async (tx) => {
      const nextAttemptNumber = delivery.attemptsCount + 1;
      const isExhausted = nextAttemptNumber >= delivery.maxAttempts;
      const nextStatus = isExhausted ? 'DEAD_LETTER' : 'FAILED';

      // Record crash diagnostic attempt
      const attemptData: NewDeliveryAttemptRecord = {
        deliveryId: delivery.id,
        attemptNumber: nextAttemptNumber,
        statusCode: null,
        responseHeaders: null,
        responseBodySnippet: null,
        executionDurationMs: leaseTimeoutSeconds * 1000,
        errorCode: 'WORKER_CRASHED',
        errorMessage: 'Worker process terminated or crashed while delivery was IN_FLIGHT',
      };

      await tx.insert(deliveryAttempts).values(attemptData);

      const [updated] = await tx
        .update(deliveries)
        .set({
          status: nextStatus,
          attemptsCount: nextAttemptNumber,
          nextRetryAt: isExhausted ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(deliveries.id, delivery.id))
        .returning();

      if (updated) {
        recovered.push(updated);
      }
    });
  }

  return recovered;
}

/**
 * Finds retry-ready deliveries (status = 'FAILED' AND next_retry_at <= NOW()) that have not
 * been touched within graceSeconds, ensuring recovery does not continually re-enqueue the same job.
 */
export async function findDueDeliveriesForRecovery(
  db: Database,
  limit = 50,
  graceSeconds = 30,
): Promise<DeliveryRecord[]> {
  return await db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, 'FAILED'),
        sql`${deliveries.attemptsCount} < ${deliveries.maxAttempts}`,
        or(isNull(deliveries.nextRetryAt), sql`${deliveries.nextRetryAt} <= NOW()`),
        sql`${deliveries.updatedAt} < NOW() - (${graceSeconds} * INTERVAL '1 second')`,
      ),
    )
    .limit(limit);
}

/**
 * Updates updatedAt on a delivery during recovery enqueueing to prevent duplicate selection
 * on subsequent recovery polling ticks while waiting in Redis.
 */
export async function touchDeliveryRecoveryTimestamp(
  db: Database,
  deliveryId: string,
): Promise<void> {
  await db
    .update(deliveries)
    .set({
      updatedAt: new Date(),
    })
    .where(eq(deliveries.id, deliveryId));
}

export interface StaleDeliveriesOptions {
  limit?: number;
  olderThanMinutes?: number;
}

/**
 * Legacy compatibility helper for existing queries.
 */
export async function findStaleDeliveries(
  db: Database,
  options?: StaleDeliveriesOptions,
): Promise<DeliveryRecord[]> {
  const limit = options?.limit ?? 50;
  const olderThanMinutes = options?.olderThanMinutes ?? 5;

  return await db
    .select()
    .from(deliveries)
    .where(
      or(
        and(
          eq(deliveries.status, 'FAILED'),
          sql`${deliveries.attemptsCount} < ${deliveries.maxAttempts}`,
          sql`${deliveries.nextRetryAt} <= NOW()`,
        ),
        and(
          eq(deliveries.status, 'IN_FLIGHT'),
          sql`${deliveries.updatedAt} < NOW() - (${olderThanMinutes} * INTERVAL '1 minute')`,
        ),
      ),
    )
    .limit(limit);
}
