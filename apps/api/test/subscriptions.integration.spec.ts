import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { getDatabaseConnection, projects, apiKeys, type Database } from '@eventforge/database';
import { generateApiKey } from '@eventforge/common';

describe('Subscriptions API Integration Tests', () => {
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
        name: 'Project Alpha (Subs Test)',
        slug: `subs-alpha-${Date.now()}`,
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

    // 2. Create Project B with API Key
    const [pB] = await db
      .insert(projects)
      .values({
        name: 'Project Beta (Subs Test)',
        slug: `subs-beta-${Date.now()}`,
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

  describe('SSRF Protection Checks', () => {
    it('should reject subscription to AWS metadata endpoint (169.254.169.254) with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/subscriptions')
        .set('X-API-Key', projectA.rawKey)
        .send({
          name: 'Malicious Cloud Metadata Hook',
          targetUrl: 'http://169.254.169.254/latest/meta-data',
          eventTypes: ['order.created'],
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('SSRF Protection');
    });

    it('should reject subscription to loopback IP (127.0.0.1) with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/subscriptions')
        .set('X-API-Key', projectA.rawKey)
        .send({
          name: 'Malicious Localhost Hook',
          targetUrl: 'http://127.0.0.1:8080/hook',
          eventTypes: ['order.created'],
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('SSRF Protection');
    });

    it('should reject subscription to private subnet (10.0.0.1) with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/subscriptions')
        .set('X-API-Key', projectA.rawKey)
        .send({
          name: 'Internal Subnet Hook',
          targetUrl: 'http://10.0.0.1/hook',
          eventTypes: ['*'],
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('SSRF Protection');
    });
  });

  describe('CRUD & Tenant Isolation', () => {
    let createdSubId: string;

    it('should register a valid public webhook subscription and return signingSecret', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/subscriptions')
        .set('X-API-Key', projectA.rawKey)
        .send({
          name: 'Production Orders Webhook',
          targetUrl: 'https://webhook.site/test-uuid-orders',
          eventTypes: ['order.created', 'payment.completed'],
          rateLimitPerSecond: 25,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Production Orders Webhook');
      expect(res.body.signingSecret).toBeDefined();
      expect(res.body.signingSecret.startsWith('whsec_')).toBe(true);

      createdSubId = res.body.id;
    });

    it('GET /v1/subscriptions should list project subscriptions and strictly omit signingSecret', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/subscriptions')
        .set('X-API-Key', projectA.rawKey);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const found = res.body.find((s: any) => s.id === createdSubId);
      expect(found).toBeDefined();
      expect(found.signingSecret).toBeUndefined(); // Signing secret MUST NOT be leaked in list queries
    });

    it('GET /v1/subscriptions/:id should return details but omit signingSecret', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/subscriptions/${createdSubId}`)
        .set('X-API-Key', projectA.rawKey);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdSubId);
      expect(res.body.signingSecret).toBeUndefined();
    });

    it('Project B should receive 404 when attempting to access Project A subscription', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/subscriptions/${createdSubId}`)
        .set('X-API-Key', projectB.rawKey);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('Project B should receive 404 when attempting to update Project A subscription', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/subscriptions/${createdSubId}`)
        .set('X-API-Key', projectB.rawKey)
        .send({ name: 'Hacked Name' });

      expect(res.status).toBe(404);
    });

    it('Project A should be able to update its subscription', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/subscriptions/${createdSubId}`)
        .set('X-API-Key', projectA.rawKey)
        .send({
          name: 'Updated Orders Webhook',
          rateLimitPerSecond: 100,
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Orders Webhook');
      expect(res.body.rateLimitPerSecond).toBe(100);
    });

    it('Project B should receive 404 when attempting to delete Project A subscription', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/subscriptions/${createdSubId}`)
        .set('X-API-Key', projectB.rawKey);

      expect(res.status).toBe(404);
    });

    it('Project A should be able to delete its subscription', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/subscriptions/${createdSubId}`)
        .set('X-API-Key', projectA.rawKey);

      expect(res.status).toBe(204);

      // Verify it no longer exists
      const checkRes = await request(app.getHttpServer())
        .get(`/v1/subscriptions/${createdSubId}`)
        .set('X-API-Key', projectA.rawKey);

      expect(checkRes.status).toBe(404);
    });
  });
});
