import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Prometheus Metrics Endpoint (Integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /v1/metrics should return 200 and valid Prometheus exposition text', async () => {
    const res = await request(app.getHttpServer()).get('/v1/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# HELP');
    expect(res.text).toContain('# TYPE');
    expect(res.text).toContain('eventforge_outbox_pending_gauge');
    expect(res.text).toContain('eventforge_db_pool_total_connections');
  });

  it('GET /metrics should also return 200 and identical Prometheus exposition text', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('eventforge_outbox_pending_gauge');
  });
});
