import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    targetUrl: text('target_url').notNull(),
    signingSecret: text('signing_secret').notNull(),
    eventTypes: jsonb('event_types').notNull().$type<string[]>(),
    isActive: boolean('is_active').default(true).notNull(),
    rateLimitPerSecond: integer('rate_limit_per_second'),
    headers: jsonb('headers').$type<Record<string, string>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('subscriptions_project_id_idx').on(table.projectId),
    index('subscriptions_project_active_idx').on(table.projectId, table.isActive),
  ],
);

export type SubscriptionRecord = typeof subscriptions.$inferSelect;
export type NewSubscriptionRecord = typeof subscriptions.$inferInsert;
