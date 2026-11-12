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

interface TestTenant {
  id: string;
  rawKey: string;
}

describe('Stats and event detail deliveries (integration)', () => {
  let app: INestApplication;
  let db: Database;
  let pool: DatabaseConnection['pool'];

  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let subAId: string;
  let multiDeliveryEventId: string;
  let deadLetterDeliveryId: string;

  async function createTenant(label: string): Promise<TestTenant> {
    const [project] = await db
      .insert(projects)
      .values({ name: `Stats ${label}`, slug: `stats-${label}-${Date.now()}` })
      .returning();
    const key = generateApiKey('ef_live');
    await db.insert(apiKeys).values({
      projectId: project!.id,
      name: `${label} key`,
      keyPrefix: key.keyPrefix,
      hashedKey: key.hashedKey,
    });
    return { id: project!.id, rawKey: key.rawKey };
  }

  async function createEvent(projectId: string, eventType: string, createdAt?: Date) {
    const [event] = await db
      .insert(events)
      .values({
        projectId,
        eventType,
        source: 'stats-test',
        payload: {},
        metadata: {},
        ...(createdAt ? { createdAt } : {}),
      })
      .returning();
    return event!;
  }

  async function createSubscription(projectId: string, name: string) {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId,
        name,
        targetUrl: 'https://customer.example.com/hook',
        signingSecret: `whsec_${name}`,
        eventTypes: ['*'],
      })
      .returning();
    return sub!;
  }

  async function createDelivery(
    projectId: string,
    eventId: string,
    subscriptionId: string,
    status: string,
    createdAt?: Date,
  ) {
    const [delivery] = await db
      .insert(deliveries)
      .values({
        projectId,
        eventId,
        subscriptionId,
        status,
        attemptsCount: status === 'PENDING' ? 0 : 1,
        ...(createdAt ? { createdAt, updatedAt: createdAt } : {}),
      })
      .returning();
    return delivery!;
  }

  beforeAll(async () => {
    const conn = getDatabaseConnection();
    db = conn.db;
    pool = conn.pool;

    tenantA = await createTenant('a');
    tenantB = await createTenant('b');

    const subA = await createSubscription(tenantA.id, 'primary-hook');
    subAId = subA.id;
    const subA2 = await createSubscription(tenantA.id, 'secondary-hook');

    // One event fanned out to two subscriptions (COMPLETED + DEAD_LETTER).
    const multi = await createEvent(tenantA.id, 'order.created');
    multiDeliveryEventId = multi.id;
    await createDelivery(tenantA.id, multi.id, subA.id, 'COMPLETED');
    const dead = await createDelivery(tenantA.id, multi.id, subA2.id, 'DEAD_LETTER');
    deadLetterDeliveryId = dead.id;
    await db.insert(deliveryAttempts).values([
      {
        deliveryId: dead.id,
        attemptNumber: 1,
        statusCode: 503,
        responseBodySnippet: 'unavailable',
        executionDurationMs: 40,
        errorCode: 'HTTP_SERVER_ERROR',
        errorMessage: 'first failure',
      },
      {
        deliveryId: dead.id,
        attemptNumber: 2,
        statusCode: 500,
        responseBodySnippet: 'boom',
        executionDurationMs: 55,
        errorCode: 'HTTP_SERVER_ERROR',
        errorMessage: 'latest failure',
      },
    ]);

    // Retrying (FAILED) and in-progress deliveries on separate events.
    const failedEvent = await createEvent(tenantA.id, 'order.updated');
    await createDelivery(tenantA.id, failedEvent.id, subA.id, 'FAILED');
    const pendingEvent = await createEvent(tenantA.id, 'order.shipped');
    await createDelivery(tenantA.id, pendingEvent.id, subA.id, 'PENDING');

    // Older than the default 24h window: must be excluded from the default view.
    const longAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const oldEvent = await createEvent(tenantA.id, 'order.old', longAgo);
    await createDelivery(tenantA.id, oldEvent.id, subA.id, 'COMPLETED', longAgo);

    // Tenant B has data that must never leak into tenant A's stats.
    const subB = await createSubscription(tenantB.id, 'b-hook');
    for (let i = 0; i < 3; i++) {
      const e = await createEvent(tenantB.id, 'b.event');
      await createDelivery(tenantB.id, e.id, subB.id, 'DEAD_LETTER');
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    try {
      for (const tenant of [tenantA, tenantB]) {
        if (tenant?.id) {
          await db.delete(projects).where(eq(projects.id, tenant.id));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
    if (app) {
      await app.close();
    }
    if (pool) {
      await closeDatabasePool(pool);
    }
  });

  describe('GET /v1/stats', () => {
    it('requires an API key', async () => {
      const res = await request(app.getHttpServer()).get('/v1/stats');
      expect(res.status).toBe(401);
    });

    it('returns status counts, success rate and recent failures within the window', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/stats')
        .set('x-api-key', tenantA.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.windowHours).toBe(24);
      expect(res.body.eventsTotal).toBe(3);
      expect(res.body.deliveriesTotal).toBe(4);
      expect(res.body.deliveriesByStatus).toEqual({
        PENDING: 1,
        IN_FLIGHT: 0,
        COMPLETED: 1,
        FAILED: 1,
        DEAD_LETTER: 1,
      });
      // 1 completed / (1 completed + 1 dead-lettered); PENDING and FAILED are undecided.
      expect(res.body.successRate).toBe(0.5);

      const failures = res.body.recentFailures as Array<Record<string, unknown>>;
      expect(failures).toHaveLength(2);
      const dead = failures.find((f) => f['deliveryId'] === deadLetterDeliveryId);
      expect(dead).toMatchObject({
        status: 'DEAD_LETTER',
        eventType: 'order.created',
        subscriptionName: 'secondary-hook',
        lastStatusCode: 500,
        lastError: 'latest failure',
      });
      expect(failures.find((f) => f['status'] === 'FAILED')).toMatchObject({
        lastStatusCode: null,
        lastError: null,
      });
    });

    it('widens the window with windowHours', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/stats?windowHours=168')
        .set('x-api-key', tenantA.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.eventsTotal).toBe(4);
      expect(res.body.deliveriesByStatus.COMPLETED).toBe(2);
    });

    it('returns a null success rate and zero counts when the project has no deliveries', async () => {
      const empty = await createTenant('empty');
      try {
        const res = await request(app.getHttpServer())
          .get('/v1/stats')
          .set('x-api-key', empty.rawKey);
        expect(res.status).toBe(200);
        expect(res.body.successRate).toBeNull();
        expect(res.body.deliveriesTotal).toBe(0);
        expect(res.body.recentFailures).toEqual([]);
      } finally {
        await db.delete(projects).where(eq(projects.id, empty.id));
      }
    });

    it('never counts another tenant’s data', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/stats')
        .set('x-api-key', tenantB.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.eventsTotal).toBe(3);
      expect(res.body.deliveriesByStatus.DEAD_LETTER).toBe(3);
      expect(res.body.deliveriesByStatus.COMPLETED).toBe(0);
      expect(res.body.successRate).toBe(0);
      const names = (res.body.recentFailures as Array<{ subscriptionName: string }>).map(
        (f) => f.subscriptionName,
      );
      expect(names.every((n) => n === 'b-hook')).toBe(true);
    });

    it.each(['0', '721', 'abc'])('rejects invalid windowHours=%s', async (value) => {
      const res = await request(app.getHttpServer())
        .get(`/v1/stats?windowHours=${value}`)
        .set('x-api-key', tenantA.rawKey);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/events/:id deliveries', () => {
    it('includes one summary per subscription delivery', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/events/${multiDeliveryEventId}`)
        .set('x-api-key', tenantA.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(multiDeliveryEventId);
      expect(res.body.deliveries).toHaveLength(2);
      const byName = Object.fromEntries(
        (res.body.deliveries as Array<{ subscriptionName: string; status: string }>).map((d) => [
          d.subscriptionName,
          d.status,
        ]),
      );
      expect(byName).toEqual({ 'primary-hook': 'COMPLETED', 'secondary-hook': 'DEAD_LETTER' });
      expect(res.body.deliveries[0]).toHaveProperty('subscriptionId', subAId);
    });

    it('returns an empty deliveries array for an event with no matching subscription', async () => {
      const lonely = await createEvent(tenantA.id, 'nobody.listens');
      const res = await request(app.getHttpServer())
        .get(`/v1/events/${lonely.id}`)
        .set('x-api-key', tenantA.rawKey);
      expect(res.status).toBe(200);
      expect(res.body.deliveries).toEqual([]);
    });

    it('does not expose another tenant’s event or its deliveries', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/events/${multiDeliveryEventId}`)
        .set('x-api-key', tenantB.rawKey);
      expect(res.status).toBe(404);
    });
  });
});
