import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { deliveries } from './deliveries.js';

export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    statusCode: integer('status_code'),
    responseHeaders: jsonb('response_headers').$type<Record<string, string>>(),
    responseBodySnippet: varchar('response_body_snippet', { length: 4096 }),
    executionDurationMs: integer('execution_duration_ms').notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('delivery_attempts_delivery_id_idx').on(table.deliveryId),
    index('delivery_attempts_created_idx').on(table.createdAt),
  ],
);

export type DeliveryAttemptRecord = typeof deliveryAttempts.$inferSelect;
export type NewDeliveryAttemptRecord = typeof deliveryAttempts.$inferInsert;
