import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    keyPrefix: varchar('key_prefix', { length: 32 }).notNull(),
    hashedKey: varchar('hashed_key', { length: 128 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('api_keys_project_id_idx').on(table.projectId),
    uniqueIndex('api_keys_hashed_key_idx').on(table.hashedKey),
  ],
);

export type ApiKeyRecord = typeof apiKeys.$inferSelect;
export type NewApiKeyRecord = typeof apiKeys.$inferInsert;
