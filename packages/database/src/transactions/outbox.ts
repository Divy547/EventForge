import { sql, eq, and } from 'drizzle-orm';
import type { Database } from '../client.js';
import { events, type EventRecord, type NewEventRecord } from '../schema/events.js';
import { outboxRecords, type OutboxRecord } from '../schema/outbox.js';

export interface InsertEventInput {
  projectId: string;
  eventType: string;
  source: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface InsertEventResult {
  event: EventRecord;
  outbox: OutboxRecord | null;
  isDuplicate: boolean;
}

/**
 * Atomically persists an event and creates its initial outbox record in a single ACID transaction.
 * If an idempotencyKey is provided and an event with that key already exists for the project,
 * the existing event is returned without creating a duplicate event or outbox record.
 */
export async function insertEventWithOutbox(
  db: Database,
  input: InsertEventInput,
): Promise<InsertEventResult> {
  return await db.transaction(async (tx) => {
    const newEventData: NewEventRecord = {
      projectId: input.projectId,
      eventType: input.eventType,
      source: input.source,
      payload: input.payload,
      metadata: input.metadata || {},
      idempotencyKey: input.idempotencyKey || null,
    };

    let event: EventRecord;

    // 1. If idempotency key is provided, perform atomic ON CONFLICT DO NOTHING
    if (input.idempotencyKey) {
      const inserted = await tx
        .insert(events)
        .values(newEventData)
        .onConflictDoNothing({
          target: [events.projectId, events.idempotencyKey],
        })
        .returning();

      if (inserted[0]) {
        event = inserted[0];
      } else {
        // Conflict detected: fetch existing event and outbox record atomically
        const existingEvents = await tx
          .select()
          .from(events)
          .where(
            and(
              eq(events.projectId, input.projectId),
              eq(events.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);

        const existingEvent = existingEvents[0];
        if (!existingEvent) {
          throw new Error('Concurrent idempotency conflict could not locate existing event');
        }

        const existingOutbox = await tx
          .select()
          .from(outboxRecords)
          .where(eq(outboxRecords.eventId, existingEvent.id))
          .limit(1);

        return {
          event: existingEvent,
          outbox: existingOutbox[0] || null,
          isDuplicate: true,
        };
      }
    } else {
      const inserted = await tx.insert(events).values(newEventData).returning();
      if (!inserted[0]) {
        throw new Error('Failed to insert event record');
      }
      event = inserted[0];
    }

    // 2. Atomically insert outbox record linked to event
    const insertedOutbox = await tx
      .insert(outboxRecords)
      .values({
        eventId: event.id,
        status: 'PENDING',
        attempts: 0,
      })
      .returning();

    const outbox = insertedOutbox[0];
    if (!outbox) {
      throw new Error('Failed to insert outbox record');
    }

    return {
      event,
      outbox,
      isDuplicate: false,
    };
  });
}

export interface ClaimOutboxOptions {
  batchSize?: number;
  claimedBy: string;
  claimTimeoutMinutes?: number;
  maxAttempts?: number;
}

/**
 * Safely claims a batch of pending (or abandoned/failed recoverable) outbox records for processing
 * using PostgreSQL's `FOR UPDATE SKIP LOCKED`.
 *
 * This prevents race conditions and lock contention across multiple concurrent worker replicas.
 */
export async function claimPendingOutboxRecords(
  db: Database,
  options: ClaimOutboxOptions,
): Promise<OutboxRecord[]> {
  const batchSize = options.batchSize || 50;
  const timeoutMinutes = options.claimTimeoutMinutes || 5;
  const maxAttempts = options.maxAttempts || 10;

  const result = await db.execute<OutboxRecord>(sql`
    WITH candidates AS (
      SELECT id
      FROM ${outboxRecords}
      WHERE ${outboxRecords.status} = 'PENDING'
         OR (
           ${outboxRecords.status} = 'PROCESSING'
           AND ${outboxRecords.claimedAt} < NOW() - (${timeoutMinutes} * INTERVAL '1 minute')
         )
         OR (
           ${outboxRecords.status} = 'FAILED'
           AND ${outboxRecords.attempts} < ${maxAttempts}
           AND ${outboxRecords.updatedAt} < NOW() - (${timeoutMinutes} * INTERVAL '1 minute')
         )
      ORDER BY ${outboxRecords.createdAt} ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${outboxRecords}
    SET
      status = 'PROCESSING',
      claimed_by = ${options.claimedBy},
      claimed_at = NOW(),
      attempts = ${outboxRecords.attempts} + 1,
      updated_at = NOW()
    FROM candidates
    WHERE ${outboxRecords.id} = candidates.id
    RETURNING ${outboxRecords}.*;
  `);

  const rawRows = result.rows as unknown as Array<Record<string, unknown>>;
  return rawRows.map((row) => ({
    id: String(row.id),
    eventId: String(row.event_id ?? row.eventId),
    status: (row.status as string) || 'PROCESSING',
    attempts: Number(row.attempts || 0),
    claimedBy: (row.claimed_by ?? row.claimedBy ?? null) as string | null,
    claimedAt:
      row.claimed_at || row.claimedAt
        ? new Date((row.claimed_at ?? row.claimedAt) as string | number | Date)
        : null,
    processedAt:
      row.processed_at || row.processedAt
        ? new Date((row.processed_at ?? row.processedAt) as string | number | Date)
        : null,
    error: (row.error ?? null) as string | null,
    createdAt: new Date((row.created_at ?? row.createdAt) as string | number | Date),
    updatedAt: new Date((row.updated_at ?? row.updatedAt) as string | number | Date),
  }));
}

/**
 * Marks an outbox record as PROCESSED upon successful fanout or delivery dispatch.
 */
export async function completeOutboxRecord(db: Database, outboxId: string): Promise<void> {
  await db
    .update(outboxRecords)
    .set({
      status: 'PROCESSED',
      processedAt: new Date(),
      updatedAt: new Date(),
      error: null,
    })
    .where(eq(outboxRecords.id, outboxId));
}

export interface FailedOutboxResult {
  id: string;
  status: 'FAILED' | 'DEAD_LETTER';
  attempts: number;
}

/**
 * Records an outbox processing failure. If attempts meet or exceed maxAttempts,
 * the record is permanently transitioned to DEAD_LETTER so it does not cause poller churn.
 */
export async function recordFailedOutboxAttempt(
  db: Database,
  outboxId: string,
  errorMessage: string,
  maxAttempts = 10,
): Promise<FailedOutboxResult> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ attempts: outboxRecords.attempts })
      .from(outboxRecords)
      .where(eq(outboxRecords.id, outboxId))
      .limit(1);

    const attempts = existing?.attempts ?? 1;
    const isExhausted = attempts >= maxAttempts;
    const nextStatus = isExhausted ? 'DEAD_LETTER' : 'FAILED';

    await tx
      .update(outboxRecords)
      .set({
        status: nextStatus,
        error: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(outboxRecords.id, outboxId));

    return {
      id: outboxId,
      status: nextStatus,
      attempts,
    };
  });
}

/**
 * Marks an outbox record as FAILED with error diagnostic metadata.
 */
export async function failOutboxRecord(
  db: Database,
  outboxId: string,
  errorMessage: string,
): Promise<void> {
  await recordFailedOutboxAttempt(db, outboxId, errorMessage, 10);
}
