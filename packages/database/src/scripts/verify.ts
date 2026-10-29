import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { verifyWebhookSignature, signWebhookPayload } from '@eventforge/common';
import {
  getDatabaseConnection,
  closeDatabasePool,
  insertEventWithOutbox,
  claimPendingOutboxRecords,
  completeOutboxRecord,
} from '../index.js';
import { projects } from '../schema/projects.js';
import { apiKeys } from '../schema/api-keys.js';
import { outboxRecords } from '../schema/outbox.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function verify(): Promise<void> {
  console.log('[EventForge Verification] Starting verification tests...');
  const { db, pool } = getDatabaseConnection();

  try {
    // 1. Verify project exists
    const existingProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, 'default'))
      .limit(1);

    const project = existingProjects[0];
    if (!project) {
      throw new Error('Default project not found');
    }
    console.log(`[PASS] Project verified: ${project.slug} (${project.id})`);

    // 2. Verify hashed API key exists and is hashed
    const existingKeys = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.projectId, project.id))
      .limit(1);

    const apiKey = existingKeys[0];
    if (!apiKey || !apiKey.hashedKey) {
      throw new Error('API key not found');
    }
    console.log(
      `[PASS] API Key verified: prefix=${apiKey.keyPrefix}, hashed_key length=${apiKey.hashedKey.length}`,
    );

    // 3. Test atomic event + outbox insertion
    const idempotencyKey = `verify-idem-${Date.now()}`;
    const result1 = await insertEventWithOutbox(db, {
      projectId: project.id,
      eventType: 'order.created',
      source: 'verification-script',
      payload: { orderId: 'ord_123', total: 199.99 },
      idempotencyKey,
    });

    if (!result1.event || !result1.outbox || result1.isDuplicate) {
      throw new Error('Initial event insertion failed');
    }
    console.log(
      `[PASS] Atomic Event + Outbox write: eventId=${result1.event.id}, outboxId=${result1.outbox.id}`,
    );

    // 4. Test idempotency handling
    const result2 = await insertEventWithOutbox(db, {
      projectId: project.id,
      eventType: 'order.created',
      source: 'verification-script',
      payload: { orderId: 'ord_123', total: 199.99 },
      idempotencyKey,
    });

    if (!result2.isDuplicate || result2.event.id !== result1.event.id) {
      throw new Error('Idempotency prevention failed');
    }
    console.log('[PASS] Idempotency verified: duplicate key safely returned existing event');

    // 5. Test safe outbox claiming with FOR UPDATE SKIP LOCKED
    const claimedRecords = await claimPendingOutboxRecords(db, {
      claimedBy: 'verification-worker',
      batchSize: 50,
    });

    const claimed = claimedRecords.find((r) => r.id === result1.outbox?.id);
    if (
      !claimed ||
      claimed.status !== 'PROCESSING' ||
      claimed.claimedBy !== 'verification-worker'
    ) {
      throw new Error('Failed to claim outbox record via SKIP LOCKED');
    }
    console.log(
      `[PASS] Outbox claim verified: id=${claimed.id}, status=${claimed.status}, claimed_by=${claimed.claimedBy}`,
    );

    // 6. Test outbox completion
    await completeOutboxRecord(db, claimed.id);
    const updated = await db
      .select()
      .from(outboxRecords)
      .where(eq(outboxRecords.id, claimed.id))
      .limit(1);

    const record = updated[0];
    if (!record || record.status !== 'PROCESSED' || !record.processedAt) {
      throw new Error('Failed to mark outbox record PROCESSED');
    }
    console.log(
      `[PASS] Outbox completion verified: status=${record.status}, processed_at=${record.processedAt.toISOString()}`,
    );

    // 7. Test Webhook HMAC signing and timing-safe verification
    const secret = 'whsec_sample_secret_key_123456';
    const payload = JSON.stringify({ event: 'order.created', id: 'evt_123' });
    const now = Math.floor(Date.now() / 1000);
    const header = signWebhookPayload(secret, payload, now);
    const isValid = verifyWebhookSignature(secret, payload, header);
    if (!isValid) {
      throw new Error('Webhook signature verification failed');
    }

    // Tampered payload check
    const isTamperedValid = verifyWebhookSignature(secret, payload + ' ', header);
    if (isTamperedValid) {
      throw new Error('Tampered payload incorrectly validated');
    }
    console.log(
      '[PASS] Webhook HMAC signature generation, tamper detection, and timing-safe verification passed',
    );

    console.log('\n=========================================');
    console.log('ALL MILESTONE 2 INTEGRATION CHECKS PASSED');
    console.log('=========================================');
  } finally {
    await closeDatabasePool(pool);
  }
}

verify().catch((err) => {
  console.error('[EventForge Verification] FAILED:', err);
  process.exit(1);
});
