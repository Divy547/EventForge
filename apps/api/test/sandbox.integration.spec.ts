import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { validateEnv } from '@eventforge/config';
import { SANDBOX_PROJECT_SLUG, SANDBOX_SCENARIO_INFO, SANDBOX_SCENARIOS } from '@eventforge/common';
import { AppModule } from '../src/app.module.js';
import { configureHttpSecurity } from '../src/common/security/http-security.js';
import {
  getDatabaseConnection,
  createProject,
  createApiKey,
  deliveries,
  events,
  subscriptions,
  projects,
  eq,
  type Database,
} from '@eventforge/database';

const RECEIVER = 'http://localhost:3000/sandbox/receiver';

/** Builds an app with the given env overrides, restoring the environment on close. */
async function createApp(overrides: Record<string, string>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  configureHttpSecurity(app, validateEnv());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return {
    app,
    async close() {
      await app.close();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

// A unique client address per test (via X-Forwarded-For) so Redis buckets never collide.
const freshIp = (): string =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe('Sandbox mode (integration)', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;
  let db: Database;
  let sandboxKey: string;
  let otherKey: string;

  const http = () => request(ctx.app.getHttpServer());

  async function sandboxProjectId(): Promise<string> {
    const [row] = await db.select().from(projects).where(eq(projects.slug, SANDBOX_PROJECT_SLUG));
    return row!.id;
  }

  /** Creates a real delivery in the sandbox project for `scenario`, as the worker would. */
  async function createSandboxDelivery(scenario: (typeof SANDBOX_SCENARIOS)[number]) {
    const projectId = await sandboxProjectId();
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.name, SANDBOX_SCENARIO_INFO[scenario].subscriptionName));
    const [event] = await db
      .insert(events)
      .values({
        projectId,
        eventType: SANDBOX_SCENARIO_INFO[scenario].eventType,
        source: 'sandbox-test',
        payload: {},
        metadata: {},
      })
      .returning();
    const [delivery] = await db
      .insert(deliveries)
      .values({ projectId, eventId: event!.id, subscriptionId: sub!.id })
      .returning();
    return delivery!.id;
  }

  beforeAll(async () => {
    ctx = await createApp({
      SANDBOX_ENABLED: 'true',
      SANDBOX_RECEIVER_URL: RECEIVER,
      SANDBOX_SESSIONS_PER_HOUR: '3',
      SANDBOX_WRITES_PER_HOUR: '4',
      TRUST_PROXY_HOPS: '1',
      RATE_LIMIT_ENABLED: 'false',
    });
    db = getDatabaseConnection().db;
    const other = await createProject(db, { name: 'Not sandbox', slug: `ns-${Date.now()}` });
    otherKey = (await createApiKey(db, { projectId: other.id, name: 'k' })).rawKey;
    const session = await http().post('/v1/sandbox/session').set('X-Forwarded-For', freshIp());
    sandboxKey = session.body.apiKey;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe('sessions', () => {
    it('hands out a short-lived key that works on the sandbox project only', async () => {
      const res = await http().post('/v1/sandbox/session').set('X-Forwarded-For', freshIp());
      expect(res.status).toBe(201);
      expect(res.body.apiKey).toMatch(/^ef_live_/);
      const ttlMs = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(59 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);

      const stats = await http().get('/v1/stats').set('X-API-Key', res.body.apiKey);
      expect(stats.status).toBe(200);
    });

    it('creates the sandbox project with one canonical subscription per scenario', async () => {
      const list = await http().get('/v1/subscriptions').set('X-API-Key', sandboxKey);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(SANDBOX_SCENARIOS.length);
      for (const scenario of SANDBOX_SCENARIOS) {
        const info = SANDBOX_SCENARIO_INFO[scenario];
        const sub = list.body.find((s: { name: string }) => s.name === info.subscriptionName);
        expect(sub).toMatchObject({
          targetUrl: `${RECEIVER}/${scenario}`,
          eventTypes: [info.eventType],
          isActive: true,
        });
        expect(sub.signingSecret).toBeUndefined();
      }
    });

    it('is rate limited per client address', async () => {
      const ip = freshIp();
      for (let i = 0; i < 3; i++) {
        const ok = await http().post('/v1/sandbox/session').set('X-Forwarded-For', ip);
        expect(ok.status).toBe(201);
      }
      const limited = await http().post('/v1/sandbox/session').set('X-Forwarded-For', ip);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      const other = await http().post('/v1/sandbox/session').set('X-Forwarded-For', freshIp());
      expect(other.status).toBe(201);
    });
  });

  describe('sending test events', () => {
    it('ingests an event of the scenario type and returns its ID', async () => {
      const res = await http()
        .post('/v1/sandbox/events')
        .set('X-API-Key', sandboxKey)
        .set('X-Forwarded-For', freshIp())
        .send({ scenario: 'flaky' });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ scenario: 'flaky', eventType: 'sandbox.flaky' });

      const event = await http().get(`/v1/events/${res.body.eventId}`).set('X-API-Key', sandboxKey);
      expect(event.status).toBe(200);
      expect(event.body.eventType).toBe('sandbox.flaky');
      expect(event.body.source).toBe('sandbox');
    });

    it('rejects an unknown scenario', async () => {
      const res = await http()
        .post('/v1/sandbox/events')
        .set('X-API-Key', sandboxKey)
        .set('X-Forwarded-For', freshIp())
        .send({ scenario: 'explode' });
      expect(res.status).toBe(400);
    });

    it('refuses keys of other projects', async () => {
      const res = await http()
        .post('/v1/sandbox/events')
        .set('X-API-Key', otherKey)
        .send({ scenario: 'succeed' });
      expect(res.status).toBe(403);
    });

    it('requires a key', async () => {
      const res = await http().post('/v1/sandbox/events').send({ scenario: 'succeed' });
      expect(res.status).toBe(401);
    });

    it('limits writes per client address, counting direct ingestion as well', async () => {
      const ip = freshIp();
      const send = () =>
        http().post('/v1/sandbox/events').set('X-API-Key', sandboxKey).set('X-Forwarded-For', ip);
      expect((await send().send({ scenario: 'succeed' })).status).toBe(202);
      expect((await send().send({ scenario: 'succeed' })).status).toBe(202);
      const direct = await http()
        .post('/v1/events')
        .set('X-API-Key', sandboxKey)
        .set('X-Forwarded-For', ip)
        .send({ eventType: 'x.y', source: 't', payload: { a: 1 } });
      expect(direct.status).toBe(202);
      expect((await send().send({ scenario: 'succeed' })).status).toBe(202);

      const limited = await send().send({ scenario: 'succeed' });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      // Reads are not counted.
      const read = await http()
        .get('/v1/events')
        .set('X-API-Key', sandboxKey)
        .set('X-Forwarded-For', ip);
      expect(read.status).toBe(200);
    });
  });

  describe('sandbox keys cannot manage subscriptions', () => {
    it('forbids create, update and delete, so no external URL can be targeted', async () => {
      const ip = freshIp();
      const create = await http()
        .post('/v1/subscriptions')
        .set('X-API-Key', sandboxKey)
        .set('X-Forwarded-For', ip)
        .send({ name: 'x', targetUrl: 'https://example.com/hook', eventTypes: ['*'] });
      expect(create.status).toBe(403);

      const list = await http().get('/v1/subscriptions').set('X-API-Key', sandboxKey);
      const id = list.body[0].id;
      const patch = await http()
        .patch(`/v1/subscriptions/${id}`)
        .set('X-API-Key', sandboxKey)
        .set('X-Forwarded-For', ip)
        .send({ targetUrl: 'https://example.com/hook' });
      expect(patch.status).toBe(403);
      const del = await http()
        .delete(`/v1/subscriptions/${id}`)
        .set('X-API-Key', sandboxKey)
        .set('X-Forwarded-For', ip);
      expect(del.status).toBe(403);
    });

    it('does not restrict other projects', async () => {
      const res = await http().get('/v1/subscriptions').set('X-API-Key', otherKey);
      expect(res.status).toBe(200);
    });
  });

  describe('demo receiver', () => {
    const post = (scenario: string, deliveryId?: string) => {
      const req = http().post(`/sandbox/receiver/${scenario}`).send({ hello: 'world' });
      return deliveryId ? req.set('X-EventForge-Delivery-Id', deliveryId) : req;
    };

    it('answers 200 for the succeed scenario', async () => {
      const res = await post('succeed', await createSandboxDelivery('succeed'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: true, scenario: 'succeed' });
    });

    it('answers 500 every time for the fail scenario', async () => {
      const id = await createSandboxDelivery('fail');
      expect((await post('fail', id)).status).toBe(500);
      expect((await post('fail', id)).status).toBe(500);
    });

    it('fails twice, then succeeds, counting attempts per delivery', async () => {
      const id = await createSandboxDelivery('flaky');
      expect((await post('flaky', id)).status).toBe(503);
      expect((await post('flaky', id)).status).toBe(503);
      expect((await post('flaky', id)).status).toBe(200);
      expect((await post('flaky', id)).status).toBe(200);

      const another = await createSandboxDelivery('flaky');
      expect((await post('flaky', another)).status).toBe(503);
    });

    it('holds the connection open until the caller gives up (slow scenario)', async () => {
      const id = await createSandboxDelivery('slow');
      const started = Date.now();
      await expect(post('slow', id).timeout(400)).rejects.toThrow(/timeout/i);
      expect(Date.now() - started).toBeLessThan(5000);
      // The server is still healthy afterwards.
      expect((await post('succeed', await createSandboxDelivery('succeed'))).status).toBe(200);
    });

    it('only answers for deliveries of the sandbox project', async () => {
      expect((await post('succeed')).status).toBe(404);
      expect((await post('succeed', 'not-a-uuid')).status).toBe(404);
      expect((await post('succeed', randomUUID())).status).toBe(404);

      // A real delivery that belongs to another project is refused too.
      const other = await createProject(db, { name: 'Other', slug: `o-${Date.now()}` });
      const [sub] = await db
        .insert(subscriptions)
        .values({
          projectId: other.id,
          name: 'o',
          targetUrl: 'https://example.com',
          signingSecret: 'whsec_x',
          eventTypes: ['*'],
        })
        .returning();
      const [event] = await db
        .insert(events)
        .values({ projectId: other.id, eventType: 'a.b', source: 's', payload: {}, metadata: {} })
        .returning();
      const [delivery] = await db
        .insert(deliveries)
        .values({ projectId: other.id, eventId: event!.id, subscriptionId: sub!.id })
        .returning();
      expect((await post('succeed', delivery!.id)).status).toBe(404);
    });

    it('rejects unknown scenarios', async () => {
      expect((await post('nope', await createSandboxDelivery('succeed'))).status).toBe(404);
    });
  });
});

describe('Sandbox mode switched off (integration)', () => {
  let ctx: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    ctx = await createApp({ SANDBOX_ENABLED: 'false', RATE_LIMIT_ENABLED: 'false' });
  });
  afterAll(async () => {
    await ctx?.close();
  });

  it('hides the session endpoint and the receiver', async () => {
    const http = () => request(ctx.app.getHttpServer());
    expect((await http().post('/v1/sandbox/session')).status).toBe(404);
    expect(
      (await http().post('/sandbox/receiver/succeed').set('X-EventForge-Delivery-Id', randomUUID()))
        .status,
    ).toBe(404);
  });
});
