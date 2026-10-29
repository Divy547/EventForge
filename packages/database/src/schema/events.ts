import { pgTable, uuid, varchar, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    eventType: varchar('event_type', { length: 255 }).notNull(),
    source: varchar('source', { length: 255 }).notNull(),
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('events_project_idempotency_idx').on(table.projectId, table.idempotencyKey),
    index('events_project_type_created_idx').on(table.projectId, table.eventType, table.createdAt),
  ],
);

export type EventRecord = typeof events.$inferSelect;
export type NewEventRecord = typeof events.$inferInsert;
