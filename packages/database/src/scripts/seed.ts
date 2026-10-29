import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { generateApiKey, generateSigningSecret } from '@eventforge/common';
import { getDatabaseConnection, closeDatabasePool } from '../client.js';
import { projects } from '../schema/projects.js';
import { apiKeys } from '../schema/api-keys.js';
import { subscriptions } from '../schema/subscriptions.js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function seed(): Promise<void> {
  console.log('[EventForge Database] Starting seed...');
  const { db, pool } = getDatabaseConnection();

  try {
    // 1. Ensure default demo project exists
    const existingProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, 'default'))
      .limit(1);

    let project = existingProjects[0];

    if (!project) {
      const inserted = await db
        .insert(projects)
        .values({
          name: 'EventForge Demo',
          slug: 'default',
        })
        .returning();
      project = inserted[0];
      console.log(`[EventForge Database] Created demo project: ${project?.id} (${project?.name})`);
    } else {
      console.log(`[EventForge Database] Demo project already exists: ${project.id}`);
    }

    if (!project) {
      throw new Error('Project could not be created or retrieved.');
    }

    // 2. Create seed API key if none exists
    const existingKeys = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.projectId, project.id))
      .limit(1);

    if (existingKeys.length === 0) {
      const { rawKey, keyPrefix, hashedKey } = generateApiKey('ef_live');
      await db.insert(apiKeys).values({
        projectId: project.id,
        name: 'Default Development Key',
        keyPrefix,
        hashedKey,
      });

      console.log('---------------------------------------------------------');
      console.log('[EventForge Seed] Generated New API Key for Demo Project:');
      console.log(`  Raw Secret Key : ${rawKey}`);
      console.log('  (Store this securely. Only the SHA-256 hash is in the DB)');
      console.log('---------------------------------------------------------');
    } else {
      console.log('[EventForge Database] Project API key already exists.');
    }

    // 3. Create demo subscription if none exists
    const existingSubs = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.projectId, project.id))
      .limit(1);

    if (existingSubs.length === 0) {
      const signingSecret = generateSigningSecret('whsec');
      await db.insert(subscriptions).values({
        projectId: project.id,
        name: 'Local Webhook Receiver',
        targetUrl: 'http://localhost:4000/webhook',
        signingSecret,
        eventTypes: ['order.created', 'payment.succeeded', 'user.signup'],
        isActive: true,
      });

      console.log(
        `[EventForge Database] Created demo subscription with secret: ${signingSecret.slice(0, 10)}...`,
      );
    } else {
      console.log('[EventForge Database] Demo subscription already exists.');
    }

    console.log('[EventForge Database] Seeding completed successfully.');
  } catch (error) {
    console.error('[EventForge Database] Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await closeDatabasePool(pool);
  }
}

seed();
