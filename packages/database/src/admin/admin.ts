import { and, eq, isNull } from 'drizzle-orm';
import { generateApiKey } from '@eventforge/common';
import type { Database } from '../client.js';
import { apiKeys, type ApiKeyRecord } from '../schema/api-keys.js';
import { projects, type ProjectRecord } from '../schema/projects.js';

/** An API key as exposed by admin operations: never includes the hash. */
export interface ApiKeySummary {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** Result of creating or rotating a key. `rawKey` is shown once and never stored. */
export interface CreatedApiKey {
  rawKey: string;
  key: ApiKeySummary;
}

export class AdminError extends Error {}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toSummary(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    keyPrefix: record.keyPrefix,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
}

export async function createProject(
  db: Database,
  input: { name: string; slug?: string },
): Promise<ProjectRecord> {
  const name = input.name.trim();
  if (!name) {
    throw new AdminError('Project name is required.');
  }
  const slug = input.slug?.trim() || slugify(name);
  if (!SLUG_PATTERN.test(slug)) {
    throw new AdminError(
      `Invalid slug "${slug}". Use lowercase letters, digits and single hyphens.`,
    );
  }

  const existing = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (existing.length > 0) {
    throw new AdminError(`A project with slug "${slug}" already exists.`);
  }

  const [project] = await db.insert(projects).values({ name, slug }).returning();
  if (!project) {
    throw new AdminError('Project could not be created.');
  }
  return project;
}

export async function listProjects(db: Database): Promise<ProjectRecord[]> {
  return db.select().from(projects).orderBy(projects.createdAt);
}

/** Resolves a project by slug or UUID. */
export async function findProject(db: Database, ref: string): Promise<ProjectRecord> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const rows = await db
    .select()
    .from(projects)
    .where(isUuid ? eq(projects.id, ref) : eq(projects.slug, ref))
    .limit(1);
  const project = rows[0];
  if (!project) {
    throw new AdminError(`Project "${ref}" not found.`);
  }
  return project;
}

export async function createApiKey(
  db: Database,
  input: { projectId: string; name: string; expiresAt?: Date },
): Promise<CreatedApiKey> {
  const name = input.name.trim();
  if (!name) {
    throw new AdminError('Key name is required.');
  }
  const { rawKey, keyPrefix, hashedKey } = generateApiKey('ef_live');
  const [record] = await db
    .insert(apiKeys)
    .values({
      projectId: input.projectId,
      name,
      keyPrefix,
      hashedKey,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!record) {
    throw new AdminError('API key could not be created.');
  }
  return { rawKey, key: toSummary(record) };
}

export async function listApiKeys(
  db: Database,
  filter: { projectId?: string } = {},
): Promise<ApiKeySummary[]> {
  const rows = filter.projectId
    ? await db.select().from(apiKeys).where(eq(apiKeys.projectId, filter.projectId))
    : await db.select().from(apiKeys);
  return rows.map(toSummary).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Revokes an active key. Fails if the key does not exist or is already revoked. */
export async function revokeApiKey(db: Database, keyId: string): Promise<ApiKeySummary> {
  const [revoked] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
    .returning();
  if (revoked) {
    return toSummary(revoked);
  }
  const existing = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  throw new AdminError(
    existing.length > 0 ? `Key ${keyId} is already revoked.` : `Key ${keyId} not found.`,
  );
}

/**
 * Replaces an active key with a new one for the same project, atomically:
 * the old key is revoked and the new key created in a single transaction.
 */
export async function rotateApiKey(
  db: Database,
  keyId: string,
  options: { name?: string } = {},
): Promise<CreatedApiKey> {
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
      .for('update')
      .limit(1);
    if (!old) {
      throw new AdminError(`Active key ${keyId} not found (missing or already revoked).`);
    }
    await tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, old.id));
    return createApiKey(tx as unknown as Database, {
      projectId: old.projectId,
      name: options.name?.trim() || old.name,
      ...(old.expiresAt ? { expiresAt: old.expiresAt } : {}),
    });
  });
}
