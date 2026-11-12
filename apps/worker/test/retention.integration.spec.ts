import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import dotenv from 'dotenv';
dotenv.config();

import {
  getDatabaseConnection,
  closeDatabasePool,
  projects,
  subscriptions,
  events,
  deliveries,
  deliveryAttempts,
  outboxRecords,
  purgeExpiredRecords,
  eq,
  inArray,
  type Database,
} from '@eventforge/database';
import { RetentionService } from '../src/outbox/retention.service.js';
import type { WorkerConfigService } from '../src/config/worker-config.service.js';
import type { WorkerDatabaseService } from '../src/database/worker-database.service.js';

const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

describe('Data retention', () => {
  let db: Database;
  let projectId: string;
  let subA: string;
  let subB: string;
  let service: RetentionService;

  interface SeedDelivery {
    sub: string;
    status: string;
    ageDays: number;
    withAttempt?: boolean;
  }
  interface SeedEvent {
    eventAgeDays: number;
    outbox?: string | null; // null = no outbox row
    deliveries?: SeedDelivery[];
  }

  const seed = async (spec: SeedEvent) => {
    const [event] = await db
      .insert(events)
      .values({
        projectId,
        eventType: 'retention.test',
        source: 'test',
        payload: {},
        createdAt: daysAgo(spec.eventAgeDays),
      })
      .returning();
    if (spec.outbox !== null) {
      await db.insert(outboxRecords).values({
        eventId: event!.id,
        status: spec.outbox ?? 'PROCESSED',
        createdAt: daysAgo(spec.eventAgeDays),
      });
    }
    const deliveryIds: string[] = [];
    for (const d of spec.deliveries ?? []) {
      const at = daysAgo(d.ageDays);
      const [row] = await db
        .insert(deliveries)
        .values({
          projectId,
          eventId: event!.id,
          subscriptionId: d.sub,
          status: d.status,
          createdAt: at,
          updatedAt: at,
          completedAt: d.status === 'COMPLETED' ? at : null,
        })
        .returning();
      deliveryIds.push(row!.id);
      if (d.withAttempt) {
        await db.insert(deliveryAttempts).values({
          deliveryId: row!.id,
          attemptNumber: 1,
          executionDurationMs: 5,
          createdAt: at,
        });
      }
    }
    return { eventId: event!.id, deliveryIds };
  };

  const eventExists = async (id: string) =>
    (await db.select().from(events).where(eq(events.id, id))).length === 1;
  const deliveryStatuses = async (ids: string[]) =>
    (await db.select().from(deliveries).where(inArray(deliveries.id, ids))).map((d) => d.status);

  beforeAll(async () => {
    db = getDatabaseConnection().db;
    const [project] = await db
      .insert(projects)
      .values({ name: 'Retention Test', slug: `retention-${Date.now()}` })
      .returning();
    projectId = project!.id;
    const subs = await db
      .insert(subscriptions)
      .values(
        ['a', 'b'].map((n) => ({
          projectId,
          name: `sub-${n}`,
          targetUrl: 'https://example.com/hook',
          signingSecret: 'whsec_x',
          eventTypes: ['*'],
        })),
      )
      .returning();
    subA = subs[0]!.id;
    subB = subs[1]!.id;

    // Small batch size so the batching loop is exercised.
    service = new RetentionService(
      { purgeExpiredRecords: (o) => purgeExpiredRecords(db, o) } as WorkerDatabaseService,
      {
        retentionDays: 30,
        retentionBatchSize: 2,
        retentionIntervalMs: 3_600_000,
      } as WorkerConfigService,
    );
  });

  afterAll(async () => {
    if (projectId && db) await db.delete(projects).where(eq(projects.id, projectId));
    await closeDatabasePool();
  });

  it('deletes expired completed data but never unfinished or replayable deliveries', async () => {
    // Fully expired: old completed delivery + attempt, old processed event. All must go.
    const expired = [] as Awaited<ReturnType<typeof seed>>[];
    for (let i = 0; i < 5; i++) {
      expired.push(
        await seed({
          eventAgeDays: 40,
          deliveries: [{ sub: subA, status: 'COMPLETED', ageDays: 40, withAttempt: true }],
        }),
      );
    }
    // Old processed event that matched no subscription: no deliveries at all.
    const noSubs = await seed({ eventAgeDays: 40 });

    // Old events whose delivery is not COMPLETED: delivery and event must both survive.
    const protectedCases = await Promise.all(
      ['PENDING', 'IN_FLIGHT', 'FAILED', 'DEAD_LETTER'].map(async (status) => ({
        status,
        ...(await seed({
          eventAgeDays: 40,
          deliveries: [{ sub: subA, status, ageDays: 40, withAttempt: true }],
        })),
      })),
    );

    // Old event not yet fanned out (outbox not PROCESSED): event must survive.
    const unprocessed = await Promise.all(
      ['PENDING', 'PROCESSING', 'FAILED', 'DEAD_LETTER'].map((outbox) =>
        seed({ eventAgeDays: 40, outbox }),
      ),
    );

    // Old event, one expired COMPLETED delivery and one DEAD_LETTER: only the completed one goes.
    const mixed = await seed({
      eventAgeDays: 40,
      deliveries: [
        { sub: subA, status: 'COMPLETED', ageDays: 40 },
        { sub: subB, status: 'DEAD_LETTER', ageDays: 40 },
      ],
    });

    // Old event but delivery completed recently (e.g. replayed): everything survives.
    const recentCompletion = await seed({
      eventAgeDays: 40,
      deliveries: [{ sub: subA, status: 'COMPLETED', ageDays: 1 }],
    });

    // Recent event with a recent completed delivery: survives.
    const recent = await seed({
      eventAgeDays: 1,
      deliveries: [{ sub: subA, status: 'COMPLETED', ageDays: 1 }],
    });

    const deleted = await service.runOnce();
    expect(deleted).toBeGreaterThan(0);

    // Expired data is gone, including cascaded attempts and outbox rows.
    for (const e of expired) {
      expect(await eventExists(e.eventId)).toBe(false);
      expect(await deliveryStatuses(e.deliveryIds)).toEqual([]);
      expect(
        await db
          .select()
          .from(deliveryAttempts)
          .where(inArray(deliveryAttempts.deliveryId, e.deliveryIds)),
      ).toEqual([]);
      expect(
        await db.select().from(outboxRecords).where(eq(outboxRecords.eventId, e.eventId)),
      ).toEqual([]);
    }
    expect(await eventExists(noSubs.eventId)).toBe(false);

    // Unfinished / replayable deliveries are untouched, with their events and attempts.
    for (const c of protectedCases) {
      expect(await deliveryStatuses(c.deliveryIds)).toEqual([c.status]);
      expect(await eventExists(c.eventId)).toBe(true);
      expect(
        await db
          .select()
          .from(deliveryAttempts)
          .where(inArray(deliveryAttempts.deliveryId, c.deliveryIds)),
      ).toHaveLength(1);
    }

    // Events awaiting fan-out are untouched.
    for (const u of unprocessed) {
      expect(await eventExists(u.eventId)).toBe(true);
    }

    // Mixed: completed delivery deleted, dead-letter delivery and event kept.
    expect(await deliveryStatuses(mixed.deliveryIds)).toEqual(['DEAD_LETTER']);
    expect(await eventExists(mixed.eventId)).toBe(true);

    // Recently completed and recent data is untouched.
    expect(await deliveryStatuses(recentCompletion.deliveryIds)).toEqual(['COMPLETED']);
    expect(await eventExists(recentCompletion.eventId)).toBe(true);
    expect(await deliveryStatuses(recent.deliveryIds)).toEqual(['COMPLETED']);
    expect(await eventExists(recent.eventId)).toBe(true);
  });

  it('is a no-op when retention is disabled', async () => {
    const old = await seed({
      eventAgeDays: 400,
      deliveries: [{ sub: subA, status: 'COMPLETED', ageDays: 400 }],
    });
    const disabled = new RetentionService(
      { purgeExpiredRecords: (o) => purgeExpiredRecords(db, o) } as WorkerDatabaseService,
      { retentionDays: 0, retentionBatchSize: 2, retentionIntervalMs: 1000 } as WorkerConfigService,
    );
    expect(await disabled.runOnce()).toBe(0);
    expect(await eventExists(old.eventId)).toBe(true);
  });
});
