/**
 * HTTP-only smoke test for a *running, production-configured* EventForge stack
 * (docker-compose.prod.yml locally, or a deployed server).
 *
 * Unlike scripts/smoke-test.ts it needs no database access, no local webhook receiver and no
 * worker port: it uses only what a real client can reach, plus (optionally) the admin CLI to
 * mint a throwaway API key. It verifies the hardening in place and that the dashboard, the stats
 * endpoint and the sandbox endpoint respond as designed, but does NOT prove that a
 * webhook is delivered, because production only delivers to public URLs. Delivery is covered by
 * `pnpm smoke-test` and the integration tests.
 *
 * Environment:
 *   API_URL          Base URL of the API (default http://127.0.0.1:3000)
 *   SMOKE_API_KEY    Use this API key instead of creating one via the admin CLI
 *   ADMIN_CMD        Command that runs the admin CLI (default: docker compose exec into the
 *                    local prod stack). Used to create/revoke the throwaway key.
 *   METRICS_TOKEN    If set, /metrics must accept it; the check that it rejects requests
 *                    without it always runs.
 *   CHECK_WORKER_PORT_CLOSED  "false" to skip the worker-port check (default: run it)
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The subset of API response bodies this script inspects. */
interface JsonBody {
  status?: string;
  isDuplicate?: boolean;
  dependencies?: { postgres?: { status?: string }; redis?: { status?: string } };
  id?: string;
  deliveries?: unknown;
  windowHours?: number;
  eventsTotal?: number;
  deliveriesTotal?: number;
  deliveriesByStatus?: Record<string, number>;
  successRate?: number | null;
  recentFailures?: unknown;
  apiKey?: string;
}

const API_URL = (process.env.API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_CMD =
  process.env.ADMIN_CMD ||
  'docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api node packages/database/dist/scripts/admin.js';
const SMOKE_PROJECT_SLUG = 'smoke-test';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`       ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` (${detail})` : ''}`);
    console.log(`       ✗ ${name}${detail ? ` (${detail})` : ''}`);
  }
}

async function api(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; headers: Headers; text: string; json: JsonBody | null }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json: JsonBody | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function admin(args: string[]): Promise<string> {
  // Arguments are fixed, shell-safe literals built in this file (slugs, UUIDs, plain names).
  const { stdout } = await execFileAsync('sh', ['-c', `${ADMIN_CMD} ${args.join(' ')}`], {
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

function portIsClosed(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (closed: boolean) => {
      socket.destroy();
      resolve(closed);
    };
    socket.setTimeout(timeoutMs, () => done(true));
    socket.on('connect', () => done(false));
    socket.on('error', () => done(true));
  });
}

async function main(): Promise<void> {
  console.log('======================================================================');
  console.log(`  EventForge HTTP smoke test (production config) -> ${API_URL}`);
  console.log('======================================================================');

  // 1. Liveness / readiness
  console.log('[1/11] Health and readiness');
  const health = await api('/v1/health');
  check('GET /v1/health returns 200', health.status === 200, `got ${health.status}`);
  const ready = await api('/v1/ready');
  check(
    'GET /v1/ready returns 200 with postgres and redis up',
    ready.status === 200 &&
      ready.json?.dependencies?.postgres?.status === 'up' &&
      ready.json?.dependencies?.redis?.status === 'up',
    `got ${ready.status}`,
  );

  // 2. Security headers
  console.log('[2/11] Security headers');
  check(
    'X-Content-Type-Options: nosniff',
    health.headers.get('x-content-type-options') === 'nosniff',
  );
  check('Strict-Transport-Security present', !!health.headers.get('strict-transport-security'));
  check('X-Powered-By absent', !health.headers.has('x-powered-by'));

  // 3. Obtain an API key
  console.log('[3/11] API key');
  let apiKey = process.env.SMOKE_API_KEY || '';
  let createdKeyId: string | null = null;
  if (!apiKey) {
    try {
      try {
        await admin(['project:create', '--name', 'smoke', '--slug', SMOKE_PROJECT_SLUG]);
      } catch {
        // project already exists from an earlier run
      }
      const out = await admin([
        'key:create',
        '--project',
        SMOKE_PROJECT_SLUG,
        '--name',
        `smoke-${Date.now()}`,
      ]);
      apiKey = /API Key\s*:\s*(\S+)/.exec(out)?.[1] ?? '';
      createdKeyId = /Key ID\s*:\s*(\S+)/.exec(out)?.[1] ?? null;
    } catch (err) {
      console.log(`       (admin CLI failed: ${err instanceof Error ? err.message : String(err)})`);
    }
  }
  check('obtained an API key (SMOKE_API_KEY or admin CLI)', apiKey.length > 0);
  if (!apiKey) {
    throw new Error('No API key available. Set SMOKE_API_KEY or ADMIN_CMD.');
  }
  const auth = { 'X-API-Key': apiKey };

  try {
    // 4. Authentication
    console.log('[4/11] Authentication');
    check('no key -> 401', (await api('/v1/subscriptions')).status === 401);
    check(
      'invalid key -> 401',
      (await api('/v1/subscriptions', { headers: { 'X-API-Key': `ef_live_${randomUUID()}` } }))
        .status === 401,
    );
    const authed = await api('/v1/subscriptions', { headers: auth });
    check('valid key -> 200', authed.status === 200, `got ${authed.status}`);

    // 5. SSRF protection
    console.log('[5/11] SSRF protection on subscription targets');
    for (const target of [
      'http://169.254.169.254/latest/meta-data',
      'http://127.0.0.1:4000/hook',
    ]) {
      const res = await api('/v1/subscriptions', {
        headers: auth,
        body: { name: 'ssrf-probe', targetUrl: target, eventTypes: ['*'] },
      });
      check(`${target} rejected with 400`, res.status === 400, `got ${res.status}`);
    }

    // 6. Event ingestion and idempotency
    console.log('[6/11] Event ingestion and idempotency');
    const idempotencyKey = `smoke-${randomUUID()}`;
    const event = {
      eventType: 'smoke.test',
      source: 'smoke-test-remote',
      payload: { ok: true },
      idempotencyKey,
    };
    const first = await api('/v1/events', { headers: auth, body: event });
    check(
      'first ingest -> 202 ACCEPTED, not duplicate',
      first.status === 202 &&
        first.json?.status === 'ACCEPTED' &&
        first.json?.isDuplicate === false,
      `got ${first.status}`,
    );
    const second = await api('/v1/events', { headers: auth, body: event });
    check(
      'same idempotency key -> 202 flagged duplicate',
      second.status === 202 && second.json?.isDuplicate === true,
      `got ${second.status}`,
    );

    // 7. Event detail and stats (the dashboard's data sources)
    console.log('[7/11] Event detail and stats');
    const eventId = first.json?.id ?? '';
    const detail = await api(`/v1/events/${eventId}`, { headers: auth });
    check(
      'GET /v1/events/:id -> 200 and includes a deliveries array',
      detail.status === 200 && Array.isArray(detail.json?.deliveries),
      `got ${detail.status}`,
    );
    check('GET /v1/stats without a key -> 401', (await api('/v1/stats')).status === 401);
    const stats = await api('/v1/stats?windowHours=24', { headers: auth });
    const counts = stats.json?.deliveriesByStatus;
    check(
      'GET /v1/stats -> 200 with the documented shape',
      stats.status === 200 &&
        stats.json?.windowHours === 24 &&
        typeof stats.json?.eventsTotal === 'number' &&
        typeof stats.json?.deliveriesTotal === 'number' &&
        ['PENDING', 'IN_FLIGHT', 'COMPLETED', 'FAILED', 'DEAD_LETTER'].every(
          (k) => typeof counts?.[k] === 'number',
        ) &&
        (stats.json?.successRate === null || typeof stats.json?.successRate === 'number') &&
        Array.isArray(stats.json?.recentFailures),
      `got ${stats.status}`,
    );
    check(
      'the event ingested above is counted in /v1/stats',
      (stats.json?.eventsTotal ?? 0) >= 1,
      `eventsTotal=${stats.json?.eventsTotal}`,
    );
    check(
      'GET /v1/stats?windowHours=0 -> 400',
      (await api('/v1/stats?windowHours=0', { headers: auth })).status === 400,
    );

    // 8. Dashboard served by the API at /dashboard
    console.log('[8/11] Dashboard');
    const page = await api('/dashboard/');
    check(
      'GET /dashboard/ -> 200 HTML, not cached',
      page.status === 200 &&
        (page.headers.get('content-type') ?? '').includes('text/html') &&
        page.headers.get('cache-control') === 'no-cache',
      `got ${page.status}`,
    );
    const spa = await api('/dashboard/events');
    check(
      'client-side route /dashboard/events falls back to index.html',
      spa.status === 200 && spa.text === page.text,
      `got ${spa.status}`,
    );
    const csp = page.headers.get('content-security-policy') ?? '';
    check(
      "dashboard CSP is same-origin (default-src 'self', no unsafe-eval, no remote hosts)",
      csp.includes("default-src 'self'") &&
        !csp.includes('unsafe-eval') &&
        !/https?:\/\//.test(csp),
      csp || 'no CSP header',
    );
    // Every script, stylesheet and icon the page loads must be a same-origin path.
    const refs = [...page.text.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '');
    check(
      'index.html loads no third-party resources',
      refs.length > 0 && refs.every((r) => r.startsWith('/dashboard/')),
      refs.filter((r) => !r.startsWith('/dashboard/')).join(', '),
    );
    const asset = refs.find((r) => r.startsWith('/dashboard/assets/'));
    const assetRes = asset ? await api(asset) : null;
    check(
      'hashed asset is served with an immutable cache header',
      assetRes?.status === 200 &&
        (assetRes.headers.get('cache-control') ?? '').includes('immutable'),
      assetRes ? `got ${assetRes.status}` : 'no asset referenced',
    );
    check(
      'a missing dashboard file returns 404, not the SPA',
      (await api('/dashboard/assets/does-not-exist.js')).status === 404,
    );

    // 9. Sandbox endpoint: off in production by default, but it must answer cleanly either way
    console.log('[9/11] Sandbox');
    const sandbox = await api('/v1/sandbox/session', { method: 'POST' });
    if (sandbox.status === 404) {
      check('sandbox mode is off: POST /v1/sandbox/session -> 404', true);
    } else {
      check(
        'sandbox mode is on: POST /v1/sandbox/session -> 201 with a key',
        sandbox.status === 201 && typeof sandbox.json?.apiKey === 'string',
        `got ${sandbox.status}`,
      );
    }

    // 10. Metrics protection
    console.log('[10/11] /metrics protection');
    const anon = await api('/v1/metrics');
    check(
      '/v1/metrics without token is rejected (401, or 404 when disabled)',
      anon.status === 401 || anon.status === 404,
      `got ${anon.status}`,
    );
    if (process.env.METRICS_TOKEN) {
      const scraped = await api('/v1/metrics', {
        headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
      });
      check(
        '/v1/metrics with METRICS_TOKEN -> 200 with eventforge_ metrics',
        scraped.status === 200 && scraped.text.includes('eventforge_'),
        `got ${scraped.status}`,
      );
    } else {
      console.log('       - METRICS_TOKEN not set: skipping authorised scrape check');
    }

    // 8. Internal surfaces closed
    console.log('[11/11] Internal surfaces');
    if (process.env.CHECK_WORKER_PORT_CLOSED === 'false') {
      console.log('       - skipped (CHECK_WORKER_PORT_CLOSED=false)');
    } else {
      const host = new URL(API_URL).hostname;
      check(`worker port ${host}:3001 is not reachable`, await portIsClosed(host, 3001));
    }
  } finally {
    if (createdKeyId) {
      try {
        await admin(['key:revoke', '--key', createdKeyId]);
        console.log('       (revoked throwaway smoke key)');
      } catch {
        console.log(`       (could not revoke throwaway key ${createdKeyId}; revoke it manually)`);
      }
    }
  }

  console.log('======================================================================');
  if (failures.length > 0) {
    console.log(`  ✗ ${failures.length} CHECK(S) FAILED (${passed} passed):`);
    for (const f of failures) console.log(`    - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ALL ${passed} CHECKS PASSED`);
  }
  console.log('======================================================================');
}

main().catch((err) => {
  console.error('✗ Remote smoke test aborted:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
