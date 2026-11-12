import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';

export interface PurgeOptions {
  /** Records older than this instant are eligible for deletion. */
  cutoff: Date;
  /** Maximum rows deleted per statement, to keep locks and transactions short. */
  batchSize?: number;
  /** Safety bound on statements per call per table, so one run cannot loop unboundedly. */
  maxBatches?: number;
}

export interface PurgeResult {
  deliveries: number;
  events: number;
}

/**
 * Deletes data past its retention window.
 *
 * Safety rules (events cascade to deliveries, attempts and outbox rows, so these matter):
 * 1. Only `COMPLETED` deliveries are deleted. `PENDING`, `IN_FLIGHT`, `FAILED` and
 *    `DEAD_LETTER` deliveries are never touched, however old, since they are in-progress
 *    work or evidence an operator may still need to replay. Their attempts are kept too.
 * 2. An old event is deleted only when no deliveries remain for it and its outbox record
 *    (if any) is `PROCESSED`. An event not yet fanned out, or still holding unfinished
 *    deliveries, is always kept.
 *
 * Deletes are batched and use `FOR UPDATE SKIP LOCKED`, so concurrent workers and live
 * delivery processing do not block each other.
 */
export async function purgeExpiredRecords(
  db: Database,
  options: PurgeOptions,
): Promise<PurgeResult> {
  const batchSize = options.batchSize ?? 1000;
  const maxBatches = options.maxBatches ?? 100;
  const cutoff = options.cutoff.toISOString();

  const deleteInBatches = async (statement: ReturnType<typeof sql>): Promise<number> => {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const result = await db.execute(statement);
      const count = result.rowCount ?? 0;
      total += count;
      if (count < batchSize) break;
    }
    return total;
  };

  // 1. Completed deliveries (delivery_attempts rows cascade).
  const deliveriesDeleted = await deleteInBatches(sql`
    DELETE FROM deliveries
    WHERE id IN (
      SELECT id FROM deliveries
      WHERE status = 'COMPLETED'
        AND COALESCE(completed_at, updated_at) < ${cutoff}::timestamptz
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
  `);

  // 2. Old, fully processed events with nothing left depending on them
  //    (outbox_records cascade).
  const eventsDeleted = await deleteInBatches(sql`
    DELETE FROM events
    WHERE id IN (
      SELECT e.id FROM events e
      WHERE e.created_at < ${cutoff}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id = e.id)
        AND NOT EXISTS (
          SELECT 1 FROM outbox_records o WHERE o.event_id = e.id AND o.status <> 'PROCESSED'
        )
      LIMIT ${batchSize}
      FOR UPDATE OF e SKIP LOCKED
    )
  `);

  return { deliveries: deliveriesDeleted, events: eventsDeleted };
}
