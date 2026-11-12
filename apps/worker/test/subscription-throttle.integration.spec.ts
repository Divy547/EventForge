import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import dotenv from 'dotenv';
dotenv.config();

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getDatabaseConnection,
  projects,
  subscriptions,
  deliveries,
  insertEventWithOutbox,
  type Database,
  eq,
  inArray,
} from '@eventforge/database';
import { WorkerModule } from '../src/worker.module.js';
import { OutboxPollerService } from '../src/outbox/outbox-poller.service.js';

describe('Per-subscription rate limiting (rateLimitPerSecond)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let poller: OutboxPollerService;
  let projectId: string;
  let server: http.Server;
  let baseUrl: string;
  const arrivals: Record<string, number[]> = { '/limited': [], '/free': [] };

  const waitForAllCompleted = async (ids: string[], timeoutMs = 20000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rows = await db.select().from(deliveries).where(inArray(deliveries.id, ids));
      if (rows.length === ids.length && rows.every((r) => r.status === 'COMPLETED')) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Timed out waiting for deliveries to complete');
  };

  beforeAll(async () => {
    process.env.ALLOW_LOCAL_WEBHOOKS = 'true';

    server = http.createServer((req, res) => {
      arrivals[req.url ?? '']?.push(Date.now());
      req.resume();
      req.on('end', () => {
        res.statusCode = 200;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await moduleRef.init();
    poller = moduleRef.get(OutboxPollerService);
    db = getDatabaseConnection().db;

    const [project] = await db
      .insert(projects)
      .values({ name: 'Throttle Integration', slug: `throttle-int-${Date.now()}` })
      .returning();
    projectId = project!.id;
  }, 30000);

  afterAll(async () => {
    if (projectId && db) await db.delete(projects).where(eq(projects.id, projectId));
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (moduleRef) await moduleRef.close();
  }, 30000);

  it('caps a rate-limited subscription at ~rateLimitPerSecond without consuming attempts, leaving others unthrottled', async () => {
    const RATE = 2;
    const COUNT = 6;

    await db.insert(subscriptions).values([
      {
        projectId,
        name: 'Limited',
        targetUrl: `${baseUrl}/limited`,
        signingSecret: 'whsec_limited',
        eventTypes: ['throttle.limited'],
        isActive: true,
        rateLimitPerSecond: RATE,
      },
      {
        projectId,
        name: 'Free',
        targetUrl: `${baseUrl}/free`,
        signingSecret: 'whsec_free',
        eventTypes: ['throttle.free'],
        isActive: true,
      },
    ]);

    const eventIds: string[] = [];
    for (const eventType of ['throttle.limited', 'throttle.free']) {
      for (let i = 0; i < COUNT; i++) {
        const { event } = await insertEventWithOutbox(db, {
          projectId,
          eventType,
          source: 'throttle-test',
          payload: { i },
        });
        eventIds.push(event.id);
      }
    }

    await poller.pollOnce();

    const rows = await db.select().from(deliveries).where(inArray(deliveries.eventId, eventIds));
    expect(rows).toHaveLength(COUNT * 2);
    await waitForAllCompleted(rows.map((r) => r.id));

    // Every delivery completed on its first HTTP attempt: throttling never burns retries.
    const finalRows = await db
      .select()
      .from(deliveries)
      .where(inArray(deliveries.eventId, eventIds));
    expect(finalRows.every((r) => r.attemptsCount === 1)).toBe(true);

    const limited = [...arrivals['/limited']!].sort((a, b) => a - b);
    expect(limited).toHaveLength(COUNT);

    // 6 deliveries at 2/s with a burst of 2 cannot finish in under ~1.5s (ideal: 2.0s).
    expect(limited[COUNT - 1]! - limited[0]!).toBeGreaterThanOrEqual(1500);

    // No 1s window may contain more than burst + sustained rate (= 2 * RATE) deliveries.
    for (const start of limited) {
      const inWindow = limited.filter((t) => t >= start && t < start + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(2 * RATE);
    }

    // The unthrottled control subscription delivered everything.
    expect(arrivals['/free']).toHaveLength(COUNT);
  }, 40000);
});
