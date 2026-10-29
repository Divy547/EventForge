import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDatabaseConnection, closeDatabasePool } from '../client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function runMigrations(): Promise<void> {
  console.log('[EventForge Database] Running migrations...');
  const { db, pool } = getDatabaseConnection();

  try {
    const migrationsFolder = path.resolve(__dirname, '../../migrations');
    console.log(`[EventForge Database] Applying migrations from: ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
    console.log('[EventForge Database] Migrations completed successfully.');
  } catch (error) {
    console.error('[EventForge Database] Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await closeDatabasePool(pool);
  }
}

runMigrations();
