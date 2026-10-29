import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Load environment variables from repository root or local directory
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: './dist/schema/index.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/eventforge',
  },
  strict: true,
  verbose: true,
});
