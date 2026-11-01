import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  getDatabaseConnection,
  closeDatabasePool,
  projects,
  apiKeys,
  subscriptions,
  events,
  deliveries,
  deliveryAttempts,
  type Database,
  type DatabaseConnection,
} from '@eventforge/database';
import { generateApiKey } from '@eventforge/common';
import { eq } from 'drizzle-orm';

describe('Deliveries & DLQ Replay Integration Tests', () => {
  let app: INestApplication;
  let db: Database;
  let pool: DatabaseConnection['pool'];

  let projectA: { id: string; rawKey: string };
  let projectB: { id: string; rawKey: string };

  let subAId: string;
  let eventAId: string;
  let deadLetterDeliveryId: string;
  let completedDeliveryId: string;

  beforeAll(async () => {
    const conn = getDatabaseConnection();
    db = conn.db;
    pool = conn.pool;

    // 1. Create Project A
    const [pA] = await db
      .insert(projects)
      .values({
        name: 'Project Alpha (DLQ Test)',
        slug: `dlq-alpha-${Date.now()}`,
      })
      .returning();

    const keyA = generateApiKey('ef_live');
    await db.insert(apiKeys).values({
      projectId: pA!.id,
      name: 'Alpha Key',
      keyPrefix: keyA.keyPrefix,
      hashedKey: keyA.hashedKey,
    });
    projectA = { id: pA!.id, rawKey: keyA.rawKey };

    // 2. Create Project B (for tenant isolation tests)
    const [pB] = await db
      .insert(projects)
      .values({
        name: 'Project Beta (DLQ Isolation Test)',
        slug: `dlq-beta-${Date.now()}`,
      })
      .returning();

    const keyB = generateApiKey('ef_live');
    await db.insert(apiKeys).values({
      projectId: pB!.id,
      name: 'Beta Key',
      keyPrefix: keyB.keyPrefix,
      hashedKey: keyB.hashedKey,
    });
    projectB = { id: pB!.id, rawKey: keyB.rawKey };

    // 3. Create Subscription for Project A
    const [subA] = await db
      .insert(subscriptions)
      .values({
        projectId: projectA.id,
        name: 'Alpha Webhook Endpoint',
        targetUrl: 'https://customer.example.com/webhooks',
        signingSecret: 'whsec_alpha_secret_123',
        eventTypes: ['order.*'],
        isActive: true,
      })
      .returning();
    subAId = subA!.id;

    // 4. Create Event for Project A
    const [evtA] = await db
      .insert(events)
      .values({
        projectId: projectA.id,
        eventType: 'order.created',
        source: 'api-test',
        payload: { orderId: 'ord_12345' },
        metadata: {},
      })
      .returning();
    eventAId = evtA!.id;

    // 5. Create DEAD_LETTER delivery for Project A
    const [dlDelivery] = await db
      .insert(deliveries)
      .values({
        projectId: projectA.id,
        eventId: eventAId,
        subscriptionId: subAId,
        status: 'DEAD_LETTER',
        attemptsCount: 5,
        maxAttempts: 5,
      })
      .returning();
    deadLetterDeliveryId = dlDelivery!.id;

    // Insert 5 historical attempts for the dead-letter delivery
    for (let i = 1; i <= 5; i++) {
      await db.insert(deliveryAttempts).values({
        deliveryId: deadLetterDeliveryId,
        attemptNumber: i,
        statusCode: 500,
        responseBodySnippet: 'Internal Server Error',
        executionDurationMs: 120,
        errorCode: 'HTTP_SERVER_ERROR',
        errorMessage: 'Remote server returned 500',
      });
    }

    // 6. Create COMPLETED delivery for Project A (with separate event to satisfy deliveries_event_subscription_idx)
    const [evtA2] = await db
      .insert(events)
      .values({
        projectId: projectA.id,
        eventType: 'order.updated',
        source: 'api-test',
        payload: { orderId: 'ord_12345_2' },
        metadata: {},
      })
      .returning();

    const [compDelivery] = await db
      .insert(deliveries)
      .values({
        projectId: projectA.id,
        eventId: evtA2!.id,
        subscriptionId: subAId,
        status: 'COMPLETED',
        attemptsCount: 1,
        maxAttempts: 5,
        completedAt: new Date(),
      })
      .returning();
    completedDeliveryId = compDelivery!.id;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    try {
      if (projectA?.id) {
        await db.delete(projects).where(eq(projects.id, projectA.id));
      }
      if (projectB?.id) {
        await db.delete(projects).where(eq(projects.id, projectB.id));
      }
    } catch {
      // Ignore cleanup error
    }
    if (app) {
      await app.close();
    }
    if (pool) {
      await closeDatabasePool(pool);
    }
  });

  describe('GET /v1/deliveries', () => {
    it('defaults to listing DEAD_LETTER deliveries for caller project', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/deliveries')
        .set('x-api-key', projectA.rawKey);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const found = res.body.data.find((d: any) => d.id === deadLetterDeliveryId);
      expect(found).toBeDefined();
      expect(found.status).toBe('DEAD_LETTER');

      // Should not contain COMPLETED deliveries by default
      const completed = res.body.data.find((d: any) => d.id === completedDeliveryId);
      expect(completed).toBeUndefined();
    });

    it('filters deliveries by status=COMPLETED when requested', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/deliveries?status=COMPLETED')
        .set('x-api-key', projectA.rawKey);

      expect(res.status).toBe(200);
      const found = res.body.data.find((d: any) => d.id === completedDeliveryId);
      expect(found).toBeDefined();
      expect(found.status).toBe('COMPLETED');
    });

    it('enforces tenant isolation and returns empty list for project with no deliveries', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/deliveries')
        .set('x-api-key', projectB.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
      expect(res.body.meta.total).toBe(0);
    });
  });

  describe('GET /v1/deliveries/:id', () => {
    it('returns delivery details, event summary, subscription info, and attempt history', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/deliveries/${deadLetterDeliveryId}`)
        .set('x-api-key', projectA.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(deadLetterDeliveryId);
      expect(res.body.status).toBe('DEAD_LETTER');
      expect(res.body.event.id).toBe(eventAId);
      expect(res.body.subscription.id).toBe(subAId);
      expect(res.body.subscription.targetUrl).toBe('https://customer.example.com/webhooks');
      // Secret must NEVER be present
      expect(res.body.subscription.signingSecret).toBeUndefined();

      expect(Array.isArray(res.body.attempts)).toBe(true);
      expect(res.body.attempts.length).toBe(5);
      expect(res.body.attempts[0].attemptNumber).toBe(1);
    });

    it('returns 404 when delivery belongs to another project (tenant boundary)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/deliveries/${deadLetterDeliveryId}`)
        .set('x-api-key', projectB.rawKey);

      expect(res.status).toBe(404);
      expect(res.body.detail || res.body.message).toContain('Delivery not found');
    });

    it('returns 400 when invalid UUID format is supplied', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/deliveries/not-a-valid-uuid')
        .set('x-api-key', projectA.rawKey);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/deliveries/:id/replay', () => {
    it('replays a DEAD_LETTER delivery, resets status to PENDING, increases maxAttempts, and preserves attempt history', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/deliveries/${deadLetterDeliveryId}/replay`)
        .set('x-api-key', projectA.rawKey)
        .send({ additionalAttempts: 3 });

      expect(res.status).toBe(200);
      expect(res.body.replayed).toBe(true);
      expect(res.body.delivery.status).toBe('PENDING');
      expect(res.body.delivery.attemptsCount).toBe(5); // Preserved!
      expect(res.body.delivery.maxAttempts).toBe(8); // 5 + 3 = 8!

      // Verify PostgreSQL state
      const [updated] = await db
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, deadLetterDeliveryId));

      expect(updated!.status).toBe('PENDING');
      expect(updated!.attemptsCount).toBe(5);
      expect(updated!.maxAttempts).toBe(8);

      // Verify historical attempts are preserved in database
      const attempts = await db
        .select()
        .from(deliveryAttempts)
        .where(eq(deliveryAttempts.deliveryId, deadLetterDeliveryId));
      expect(attempts.length).toBe(5);
    });

    it('returns 409 Conflict when attempting to replay a non-dead-letter delivery', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/deliveries/${completedDeliveryId}/replay`)
        .set('x-api-key', projectA.rawKey)
        .send({ additionalAttempts: 3 });

      expect(res.status).toBe(409);
      expect(res.body.detail || res.body.message).toContain(
        "only 'DEAD_LETTER' deliveries can be replayed",
      );
    });

    it('returns 404 when Project B attempts to replay Project A delivery', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/deliveries/${deadLetterDeliveryId}/replay`)
        .set('x-api-key', projectB.rawKey)
        .send({ additionalAttempts: 3 });

      expect(res.status).toBe(404);
      expect(res.body.detail || res.body.message).toContain('Delivery not found');
    });
  });

  describe('POST /v1/deliveries/replay (Batch Replay)', () => {
    it('batch replays dead-letter deliveries and reports per-item results for mixed batch', async () => {
      const [evtBatch] = await db
        .insert(events)
        .values({
          projectId: projectA.id,
          eventType: 'order.cancelled',
          source: 'api-test',
          payload: { orderId: 'ord_batch_1' },
          metadata: {},
        })
        .returning();

      // Create a dead-letter delivery for batch replay
      const [dl1] = await db
        .insert(deliveries)
        .values({
          projectId: projectA.id,
          eventId: evtBatch!.id,
          subscriptionId: subAId,
          status: 'DEAD_LETTER',
          attemptsCount: 3,
          maxAttempts: 3,
        })
        .returning();

      const nonExistentId = 'a0000000-0000-4000-8000-000000000000';

      const res = await request(app.getHttpServer())
        .post('/v1/deliveries/replay')
        .set('x-api-key', projectA.rawKey)
        .send({
          deliveryIds: [dl1!.id, completedDeliveryId, nonExistentId],
          additionalAttempts: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.totalRequested).toBe(3);
      expect(res.body.replayedCount).toBe(1);
      expect(res.body.failedCount).toBe(2);

      const items = res.body.items;
      const dl1Item = items.find((i: any) => i.deliveryId === dl1!.id);
      expect(dl1Item.success).toBe(true);
      expect(dl1Item.status).toBe('PENDING');

      const completedItem = items.find((i: any) => i.deliveryId === completedDeliveryId);
      expect(completedItem.success).toBe(false);
      expect(completedItem.statusCode).toBe(409);

      const nonExistentItem = items.find((i: any) => i.deliveryId === nonExistentId);
      expect(nonExistentItem.success).toBe(false);
      expect(nonExistentItem.statusCode).toBe(404);
    });
  });
});
