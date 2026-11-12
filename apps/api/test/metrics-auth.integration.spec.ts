import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

const TOKEN = 'metrics-token-for-tests-123';

async function createApp(env: Record<string, string | undefined>): Promise<{
  app: INestApplication;
  restore: () => void;
}> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  await app.init();
  return {
    app,
    restore: () => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

describe('API /metrics protection', () => {
  describe('with METRICS_TOKEN set', () => {
    let app: INestApplication;
    let restore: () => void;

    beforeAll(async () => {
      ({ app, restore } = await createApp({ METRICS_TOKEN: TOKEN }));
    });
    afterAll(async () => {
      await app?.close();
      restore?.();
    });

    it('rejects requests without a token (401)', async () => {
      expect((await request(app.getHttpServer()).get('/v1/metrics')).status).toBe(401);
      expect((await request(app.getHttpServer()).get('/metrics')).status).toBe(401);
    });

    it('rejects a wrong token (401)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/metrics')
        .set('Authorization', 'Bearer wrong-token-of-any-length');
      expect(res.status).toBe(401);
    });

    it('serves metrics with the correct bearer token', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/metrics')
        .set('Authorization', `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('# HELP');
    });
  });

  describe('in production without METRICS_TOKEN', () => {
    let app: INestApplication;
    let restore: () => void;

    beforeAll(async () => {
      // The pool connects lazily and /metrics is rejected before any query, so these
      // non-default (production-valid) credentials never need to be real.
      ({ app, restore } = await createApp({
        NODE_ENV: 'production',
        METRICS_TOKEN: undefined,
        DATABASE_URL: 'postgresql://eventforge_prod:not-the-default@localhost:5432/eventforge',
      }));
    });
    afterAll(async () => {
      await app?.close();
      restore?.();
    });

    it('is disabled (404) rather than exposed', async () => {
      const res = await request(app.getHttpServer()).get('/v1/metrics');
      expect(res.status).toBe(404);
    });
  });
});
