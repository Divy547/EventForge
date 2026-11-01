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
  events,
  outboxRecords,
  type Database,
  type DatabaseConnection,
} from '@eventforge/database';
import { generateApiKey, W3C_TRACEPARENT_HEADER } from '@eventforge/common';
import { eq } from 'drizzle-orm';

describe('Event Ingestion Concurrency & Tracing Tests', () => {
  let app: INestApplication;
  let db: Database;
  let pool: DatabaseConnection['pool'];

  let testProject: { id: string; rawKey: string };

  beforeAll(async () => {
    const conn = getDatabaseConnection();
    db = conn.db;
    pool = conn.pool;

    const [proj] = await db
      .insert(projects)
      .values({
        name: 'Concurrency Ingestion Test Project',
        slug: `concurrency-test-${Date.now()}`,
      })
      .returning();

    const apiKey = generateApiKey('ef_live');
    await db.insert(apiKeys).values({
      projectId: proj!.id,
      name: 'Concurrency Key',
      keyPrefix: apiKey.keyPrefix,
      hashedKey: apiKey.hashedKey,
    });
    testProject = { id: proj!.id, rawKey: apiKey.rawKey };

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
      if (testProject?.id) {
        await db.delete(projects).where(eq(projects.id, testProject.id));
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

  it('handles 20 concurrent duplicate event ingestions atomically without PostgreSQL 23505 errors', async () => {
    const idempotencyKey = `race-test-${Date.now()}-${Math.random()}`;
    const payload = {
      eventType: 'payment.completed',
      source: 'stripe-webhook',
      idempotencyKey,
      payload: { chargeId: 'ch_123', amount: 9900 },
    };

    // Dispatch 20 requests concurrently in parallel
    const promises = Array.from({ length: 20 }).map(() =>
      request(app.getHttpServer())
        .post('/v1/events')
        .set('x-api-key', testProject.rawKey)
        .send(payload),
    );

    const responses = await Promise.all(promises);

    // 1. None should fail with 500 or 409
    for (const res of responses) {
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('ACCEPTED');
      expect(res.body.eventType).toBe('payment.completed');
    }

    // 2. All responses must reference the exact same event ID
    const eventIds = new Set(responses.map((r) => r.body.id));
    expect(eventIds.size).toBe(1);
    const primaryEventId = responses[0]!.body.id;

    // 3. Exactly one must have isDuplicate: false, and 19 must have isDuplicate: true
    const nonDuplicates = responses.filter((r) => r.body.isDuplicate === false);
    const duplicates = responses.filter((r) => r.body.isDuplicate === true);

    expect(nonDuplicates.length).toBe(1);
    expect(duplicates.length).toBe(19);

    // 4. Exactly one event and one outbox record must exist in PostgreSQL
    const persistedEvents = await db.select().from(events).where(eq(events.id, primaryEventId));
    expect(persistedEvents.length).toBe(1);

    const persistedOutbox = await db
      .select()
      .from(outboxRecords)
      .where(eq(outboxRecords.eventId, primaryEventId));
    expect(persistedOutbox.length).toBe(1);
    expect(persistedOutbox[0]!.status).toBe('PENDING');
  });

  it('propagates incoming W3C traceparent into event metadata and returns traceparent in HTTP response', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

    const res = await request(app.getHttpServer())
      .post('/v1/events')
      .set('x-api-key', testProject.rawKey)
      .set(W3C_TRACEPARENT_HEADER, traceparent)
      .send({
        eventType: 'user.signup',
        source: 'auth-service',
        payload: { userId: 'usr_789' },
      });

    expect(res.status).toBe(202);
    expect(res.headers[W3C_TRACEPARENT_HEADER]).toBe(traceparent);

    const eventId = res.body.id;
    const [persisted] = await db.select().from(events).where(eq(events.id, eventId));
    expect(persisted).toBeDefined();
    expect((persisted!.metadata as Record<string, unknown>).traceparent).toBe(traceparent);
  });

  it('generates a compliant W3C root traceparent when none is provided in request headers', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/events')
      .set('x-api-key', testProject.rawKey)
      .send({
        eventType: 'order.placed',
        source: 'storefront',
        payload: { cartId: 'crt_456' },
      });

    expect(res.status).toBe(202);
    const traceparentHeader = res.headers[W3C_TRACEPARENT_HEADER];
    expect(traceparentHeader).toBeDefined();
    expect(traceparentHeader).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const eventId = res.body.id;
    const [persisted] = await db.select().from(events).where(eq(events.id, eventId));
    expect((persisted!.metadata as Record<string, unknown>).traceparent).toBe(traceparentHeader);
  });
});
