import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { configureHttpSecurity } from '../src/common/security/http-security.js';
import {
  configureDashboard,
  defaultDashboardDir,
} from '../src/common/dashboard/serve-dashboard.js';

@Controller('v1')
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

const securityConfig = { CORS_ALLOWED_ORIGINS: [], TRUST_PROXY_HOPS: 0 };

async function createApp(dir: string): Promise<{ app: NestExpressApplication; served: boolean }> {
  const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttpSecurity(app, securityConfig);
  const served = configureDashboard(app, dir);
  await app.init();
  return { app, served };
}

describe('dashboard static serving', () => {
  let dir: string;
  let app: INestApplication;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'ef-dashboard-'));
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><title>EF</title><div id="root"></div>',
    );
    writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    ({ app } = await createApp(dir));
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html at /dashboard and /dashboard/ without caching', async () => {
    for (const url of ['/dashboard', '/dashboard/']) {
      const res = await request(app.getHttpServer()).get(url).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/events/abc-123').expect(200);
    expect(res.text).toContain('<div id="root">');
  });

  it('serves hashed assets as immutable and other files uncached', async () => {
    const asset = await request(app.getHttpServer())
      .get('/dashboard/assets/index-abc123.js')
      .expect(200);
    expect(asset.headers['content-type']).toMatch(/javascript/);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const icon = await request(app.getHttpServer()).get('/dashboard/favicon.svg').expect(200);
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('returns 404, not index.html, for a missing file', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/assets/missing.js').expect(404);
    expect(res.text).not.toContain('<div id="root">');
  });

  it('does not expose files outside the bundle directory', async () => {
    await request(app.getHttpServer()).get('/dashboard/%2e%2e/%2e%2e/package.json').expect(404);
  });

  it('does not shadow API routes', async () => {
    const res = await request(app.getHttpServer()).get('/v1/ping').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('applies a same-origin CSP that allows inline styles, for /dashboard only', async () => {
    const page = await request(app.getHttpServer()).get('/dashboard/').expect(200);
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/https:/);
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).toContain("frame-ancestors 'self'");

    const api = await request(app.getHttpServer()).get('/v1/ping').expect(200);
    const apiCsp = String(api.headers['content-security-policy']);
    expect(apiCsp).toContain('https:'); // helmet's default policy is unchanged for the API
  });

  it('serves nothing when the bundle has not been built', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'ef-dashboard-empty-'));
    try {
      const { app: bare, served } = await createApp(empty);
      expect(served).toBe(false);
      await request(bare.getHttpServer()).get('/dashboard/').expect(404);
      await bare.close();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('resolves the default bundle location next to apps/api', () => {
    expect(defaultDashboardDir('/app/apps/api/dist')).toBe('/app/apps/dashboard/dist');
  });
});
