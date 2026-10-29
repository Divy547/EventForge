import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
}

let activeConnection: DatabaseConnection | null = null;

/**
 * Creates or retrieves a managed PostgreSQL connection pool and Drizzle client.
 */
export function getDatabaseConnection(options?: {
  connectionString?: string;
  maxConnections?: number;
}): DatabaseConnection {
  if (activeConnection) {
    return activeConnection;
  }

  const connectionString =
    options?.connectionString ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/eventforge';
  const max = options?.maxConnections || Number(process.env.DATABASE_MAX_CONNECTIONS) || 20;

  const { Pool } = pg;
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const db = drizzle(pool, { schema });

  activeConnection = { db, pool };
  return activeConnection;
}

/**
 * Executes a lightweight SELECT 1 health check to measure latency and verify connectivity.
 */
export async function checkDatabaseHealth(
  pool: pg.Pool,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } finally {
      client.release();
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Gracefully shuts down the connection pool.
 */
export async function closeDatabasePool(pool?: pg.Pool): Promise<void> {
  const targetPool = pool || activeConnection?.pool;
  if (targetPool) {
    try {
      const p = targetPool as unknown as { ending?: boolean; ended?: boolean };
      if (!p.ending && !p.ended) {
        await targetPool.end();
      }
    } catch {
      // Ignore if pool already closed
    }
  }
  if (activeConnection && (!pool || activeConnection.pool === pool)) {
    activeConnection = null;
  }
}
