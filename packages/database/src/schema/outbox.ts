import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { events } from './events.js';

export const outboxRecords = pgTable(
  'outbox_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    attempts: integer('attempts').default(0).notNull(),
    claimedBy: varchar('claimed_by', { length: 255 }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('outbox_records_event_id_idx').on(table.eventId),
    index('outbox_records_status_created_idx').on(table.status, table.createdAt),
  ],
);

export type OutboxRecord = typeof outboxRecords.$inferSelect;
export type NewOutboxRecord = typeof outboxRecords.$inferInsert;
