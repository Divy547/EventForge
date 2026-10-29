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
    // 1. Idempotency check if key provided
    if (input.idempotencyKey) {
      const existing = await tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.projectId, input.projectId),
            eq(events.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      const existingEvent = existing[0];
      if (existingEvent) {
        // Query corresponding outbox record if present
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
    }

    // 2. Insert event
    const newEventData: NewEventRecord = {
      projectId: input.projectId,
      eventType: input.eventType,
      source: input.source,
      payload: input.payload,
      metadata: input.metadata || {},
      idempotencyKey: input.idempotencyKey || null,
    };

    const insertedEvents = await tx.insert(events).values(newEventData).returning();
    const event = insertedEvents[0];
    if (!event) {
      throw new Error('Failed to insert event record');
    }

    // 3. Atomically insert outbox record linked to event
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

/**
 * Marks an outbox record as FAILED with error diagnostic metadata.
 */
export async function failOutboxRecord(
  db: Database,
  outboxId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(outboxRecords)
    .set({
      status: 'FAILED',
      error: errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(outboxRecords.id, outboxId));
}
