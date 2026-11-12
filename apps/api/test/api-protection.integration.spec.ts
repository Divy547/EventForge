import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { validateEnv } from '@eventforge/config';
import { AppModule } from '../src/app.module.js';
import { configureHttpSecurity } from '../src/common/security/http-security.js';
import { getDatabaseConnection, createProject, createApiKey } from '@eventforge/database';

const ALLOWED_ORIGIN = 'https://dashboard.example.test';
const ENV_OVERRIDES = {
  RATE_LIMIT_ENABLED: 'true',
  RATE_LIMIT_WINDOW_SECONDS: '10',
  RATE_LIMIT_KEY_MAX: '3',
  RATE_LIMIT_IP_MAX: '5',
  CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  TRUST_PROXY_HOPS: '1',
};

describe('API protection (rate limiting, helmet, CORS)', () => {
  let app: INestApplication;
  let keyA: string;
  let keyB: string;
  const saved: Record<string, string | undefined> = {};

  // Unique client IP per test (via X-Forwarded-For) so Redis buckets never collide.
  const freshIp = (): string =>
    `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV_OVERRIDES)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }

    const { db } = getDatabaseConnection();
    const project = await createProject(db, {
      name: 'Protection Test',
      slug: `prot-${Date.now()}`,
    });
    keyA = (await createApiKey(db, { projectId: project.id, name: 'a' })).rawKey;
    keyB = (await createApiKey(db, { projectId: project.id, name: 'b' })).rawKey;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttpSecurity(app, validateEnv());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns 429 with Retry-After once the per-key limit is exceeded, without affecting other keys', async () => {
    const ip = freshIp();
    const get = (key: string) =>
      request(app.getHttpServer())
        .get('/v1/subscriptions')
        .set('X-API-Key', key)
        .set('X-Forwarded-For', ip);

    for (let i = 0; i < 3; i++) {
      expect((await get(keyA)).status).toBe(200);
    }
    const limited = await get(keyA);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(10);

    // Other key, same IP, still within the IP budget (4 used of 5).
    expect((await get(keyB)).status).toBe(200);
  });

  it('throttles repeated invalid-key attempts per IP (429 instead of endless 401)', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app.getHttpServer())
        .get('/v1/subscriptions')
        .set('X-API-Key', `ef_live_invalid_${randomUUID()}`)
        .set('X-Forwarded-For', ip);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('sends helmet security headers and hides x-powered-by', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health')
      .set('X-Forwarded-For', freshIp());
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for allow-listed origins', async () => {
    const ok = await request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('X-Forwarded-For', freshIp());
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    const denied = await request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', 'https://evil.example.test')
      .set('X-Forwarded-For', freshIp());
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const preflightDenied = await request(app.getHttpServer())
      .options('/v1/events')
      .set('Origin', 'https://evil.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('X-Forwarded-For', freshIp());
    expect(preflightDenied.headers['access-control-allow-origin']).toBeUndefined();

    const preflightOk = await request(app.getHttpServer())
      .options('/v1/events')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('X-Forwarded-For', freshIp());
    expect(preflightOk.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});
