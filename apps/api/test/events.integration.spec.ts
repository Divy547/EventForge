import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  getDatabaseConnection,
  projects,
  apiKeys,
  events,
  outboxRecords,
  type Database,
} from '@eventforge/database';
import { generateApiKey } from '@eventforge/common';
import { eq } from 'drizzle-orm';

describe('Events API Integration Tests', () => {
  let app: INestApplication;
  let db: Database;

  let projectA: { id: string; rawKey: string };
  let projectB: { id: string; rawKey: string };

  beforeAll(async () => {
    const conn = getDatabaseConnection();
    db = conn.db;

    // 1. Create Project A with API Key
    const [pA] = await db
      .insert(projects)
      .values({
        name: 'Project Alpha (Events Test)',
        slug: `events-alpha-${Date.now()}`,
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

    // 2. Create Project B with API Key (for tenant isolation tests)
    const [pB] = await db
      .insert(projects)
      .values({
        name: 'Project Beta (Events Test)',
        slug: `events-beta-${Date.now()}`,
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

    // 3. Initialize NestJS app
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
    if (app) {
      await app.close();
    }
  });

  describe('Health Endpoints', () => {
    it('GET /v1/health should return 200 without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /v1/ready should verify dependencies without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/v1/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.dependencies.postgres.status).toBe('up');
      expect(res.body.dependencies.redis.status).toBe('up');
    });
  });

  describe('POST /v1/events (Event Ingestion)', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/events')
        .send({
          eventType: 'test.event',
          source: 'test',
          payload: { a: 1 },
        });
      expect(res.status).toBe(401);
    });

    it('should accept valid event and atomically write to events & outbox', async () => {
      const idempotencyKey = `idem-${Date.now()}`;
      const payload = { orderId: 'ord_123', amount: 50.0 };

      const res = await request(app.getHttpServer())
        .post('/v1/events')
        .set('X-API-Key', projectA.rawKey)
        .send({
          eventType: 'order.placed',
          source: 'checkout-service',
          payload,
          idempotencyKey,
        });

      expect(res.status).toBe(202);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('ACCEPTED');
      expect(res.body.isDuplicate).toBe(false);

      // Verify DB persistence
      const [dbEvent] = await db.select().from(events).where(eq(events.id, res.body.id));
      expect(dbEvent).toBeDefined();
      expect(dbEvent!.projectId).toBe(projectA.id);

      const [dbOutbox] = await db
        .select()
        .from(outboxRecords)
        .where(eq(outboxRecords.eventId, res.body.id));
      expect(dbOutbox).toBeDefined();
      expect(dbOutbox!.status).toBe('PENDING');
    });

    it('should handle duplicate idempotency key idempotently', async () => {
      const idempotencyKey = `idem-dup-${Date.now()}`;
      const body = {
        eventType: 'payment.processed',
        source: 'payment-gateway',
        payload: { tx: 'tx_999' },
        idempotencyKey,
      };

      // First call
      const res1 = await request(app.getHttpServer())
        .post('/v1/events')
        .set('X-API-Key', projectA.rawKey)
        .send(body);

      expect(res1.status).toBe(202);
      expect(res1.body.isDuplicate).toBe(false);

      // Second call with same key
      const res2 = await request(app.getHttpServer())
        .post('/v1/events')
        .set('X-API-Key', projectA.rawKey)
        .send(body);

      expect(res2.status).toBe(202);
      expect(res2.body.id).toBe(res1.body.id);
      expect(res2.body.isDuplicate).toBe(true);

      // Verify only 1 event exists
      const matching = await db
        .select()
        .from(events)
        .where(eq(events.idempotencyKey, idempotencyKey));
      expect(matching.length).toBe(1);
    });

    it('should reject invalid eventType format with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/events')
        .set('X-API-Key', projectA.rawKey)
        .send({
          eventType: 'invalid event type with spaces!',
          source: 'test',
          payload: {},
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /v1/events & GET /v1/events/:id (Retrieval & Tenant Isolation)', () => {
    let createdEventId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/events')
        .set('X-API-Key', projectA.rawKey)
        .send({
          eventType: 'user.signup',
          source: 'auth-service',
          payload: { userId: 'u_123' },
        });
      createdEventId = res.body.id;
    });

    it('Project A should be able to retrieve its own event by ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/events/${createdEventId}`)
        .set('X-API-Key', projectA.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdEventId);
      expect(res.body.projectId).toBe(projectA.id);
    });

    it('Project B should receive 404 when attempting to retrieve Project A event', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/events/${createdEventId}`)
        .set('X-API-Key', projectB.rawKey);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('GET /v1/events should list Project A events with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/events?limit=10&page=1')
        .set('X-API-Key', projectA.rawKey);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta.total).toBeGreaterThan(0);
      expect(res.body.meta.page).toBe(1);
    });

    it('GET /v1/events for Project B should not see Project A events', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/events')
        .set('X-API-Key', projectB.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
      expect(res.body.meta.total).toBe(0);
    });
  });
});
