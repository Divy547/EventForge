import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.js';
import { events } from './events.js';
import { subscriptions } from './subscriptions.js';

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    attemptsCount: integer('attempts_count').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('deliveries_event_subscription_idx').on(table.eventId, table.subscriptionId),
    index('deliveries_status_retry_idx').on(table.status, table.nextRetryAt),
    index('deliveries_project_created_idx').on(table.projectId, table.createdAt),
  ],
);

export type DeliveryRecord = typeof deliveries.$inferSelect;
export type NewDeliveryRecord = typeof deliveries.$inferInsert;
