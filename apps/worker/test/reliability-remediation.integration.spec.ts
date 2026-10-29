import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import dotenv from 'dotenv';
dotenv.config();

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import {
  getDatabaseConnection,
  projects,
  subscriptions,
  deliveries,
  deliveryAttempts,
  outboxRecords,
  insertEventWithOutbox,
  claimDeliveryForProcessing,
  recoverAbandonedInFlightDeliveries,
  findDueDeliveriesForRecovery,
  touchDeliveryRecoveryTimestamp,
  type Database,
  eq,
} from '@eventforge/database';
import { WorkerModule } from '../src/worker.module.js';
import { OutboxPollerService } from '../src/outbox/outbox-poller.service.js';
import { DeliveryProcessor } from '../src/delivery/delivery.processor.js';
import { StaleDeliveryRecoveryService } from '../src/outbox/stale-delivery-recovery.service.js';
import { DELIVERY_QUEUE } from '../src/redis/redis.provider.js';

describe('Milestone 4 Reliability Remediation Integration Tests', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let outboxPoller: OutboxPollerService;
  let deliveryProcessor: DeliveryProcessor;
  let staleRecovery: StaleDeliveryRecoveryService;
  let deliveryQueue: Queue;

  let testProjectId: string;
  let mockServer: http.Server;
  let mockServerUrl: string;

  beforeAll(async () => {
    process.env.ALLOW_LOCAL_WEBHOOKS = 'true';

    // 1. Mock server
    mockServer = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = mockServer.address() as AddressInfo;
    mockServerUrl = `http://127.0.0.1:${addr.port}`;

    // 2. Initialize NestJS testing module
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    await moduleRef.init();

    outboxPoller = moduleRef.get(OutboxPollerService);
    deliveryProcessor = moduleRef.get(DeliveryProcessor);
    staleRecovery = moduleRef.get(StaleDeliveryRecoveryService);
    deliveryQueue = moduleRef.get(DELIVERY_QUEUE);
    db = getDatabaseConnection().db;

    const [project] = await db
      .insert(projects)
      .values({
        name: 'Reliability Remediation Project',
        slug: `remediation-int-${Date.now()}`,
      })
      .returning();

    testProjectId = project!.id;
  });

  afterAll(async () => {
    if (testProjectId && db) {
      await db.delete(projects).where(eq(projects.id, testProjectId));
    }

    if (mockServer) {
      await new Promise<void>((resolve) => {
        mockServer.close(() => resolve());
      });
    }

    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('enforces backoff: future next_retry_at prevents claim, but becomes claimable once due', async () => {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Backoff Test Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['test.event'],
        isActive: true,
      })
      .returning();

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'test.event',
      source: 'test-src',
      payload: {},
    });

    // 1. Create a FAILED delivery with nextRetryAt 1 hour in the future
    const futureDate = new Date(Date.now() + 3600 * 1000);
    const [del] = await db
      .insert(deliveries)
      .values({
        projectId: testProjectId,
        eventId: event.id,
        subscriptionId: sub!.id,
        status: 'FAILED',
        attemptsCount: 1,
        maxAttempts: 5,
        nextRetryAt: futureDate,
      })
      .returning();

    // 2. Attempt to claim: should be rejected because backoff is not due
    const prematureClaim = await claimDeliveryForProcessing(db, del!.id);
    expect(prematureClaim).toBeNull();

    // Verify status remains FAILED in DB
    const [stillFailed] = await db.select().from(deliveries).where(eq(deliveries.id, del!.id));
    expect(stillFailed!.status).toBe('FAILED');
    expect(stillFailed!.attemptsCount).toBe(1);

    // 3. Update nextRetryAt to the past (due for retry)
    await db
      .update(deliveries)
      .set({
        nextRetryAt: new Date(Date.now() - 5000),
      })
      .where(eq(deliveries.id, del!.id));

    // 4. Attempt claim: should succeed and transition to IN_FLIGHT
    const dueClaim = await claimDeliveryForProcessing(db, del!.id);
    expect(dueClaim).not.toBeNull();
    expect(dueClaim!.status).toBe('IN_FLIGHT');
    expect(dueClaim!.id).toBe(del!.id);
  });

  it('enforces maximum-attempt policy atomically and transitions exhausted deliveries to DEAD_LETTER', async () => {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Max Attempts Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['exhaust.event'],
        isActive: true,
      })
      .returning();

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'exhaust.event',
      source: 'test-src',
      payload: {},
    });

    // Delivery that has reached maxAttempts (5/5) but remained in IN_FLIGHT due to repeated crashes
    const [del] = await db
      .insert(deliveries)
      .values({
        projectId: testProjectId,
        eventId: event.id,
        subscriptionId: sub!.id,
        status: 'IN_FLIGHT',
        attemptsCount: 5,
        maxAttempts: 5,
        updatedAt: new Date(Date.now() - 120 * 1000), // 2 min ago
      })
      .returning();

    // Attempting to claim must fail and transition delivery directly to DEAD_LETTER
    const claimResult = await claimDeliveryForProcessing(db, del!.id, {
      leaseTimeoutSeconds: 60,
    });
    expect(claimResult).toBeNull();

    const [exhaustedDel] = await db.select().from(deliveries).where(eq(deliveries.id, del!.id));
    expect(exhaustedDel!.status).toBe('DEAD_LETTER');
    expect(exhaustedDel!.nextRetryAt).toBeNull();
  });

  it('guarantees mutual exclusion when recovery and BullMQ retry arrive concurrently', async () => {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Concurrency Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['concurrent.event'],
        isActive: true,
      })
      .returning();

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'concurrent.event',
      source: 'test-src',
      payload: {},
    });

    const [del] = await db
      .insert(deliveries)
      .values({
        projectId: testProjectId,
        eventId: event.id,
        subscriptionId: sub!.id,
        status: 'FAILED',
        attemptsCount: 1,
        maxAttempts: 5,
        nextRetryAt: new Date(Date.now() - 1000),
      })
      .returning();

    // Two parallel claim attempts at the exact same time
    const [claimA, claimB] = await Promise.all([
      claimDeliveryForProcessing(db, del!.id),
      claimDeliveryForProcessing(db, del!.id),
    ]);

    // Exactly one must succeed, the other must be rejected
    const successfulClaims = [claimA, claimB].filter((c) => c !== null);
    const rejectedClaims = [claimA, claimB].filter((c) => c === null);

    expect(successfulClaims).toHaveLength(1);
    expect(rejectedClaims).toHaveLength(1);
    expect(successfulClaims[0]!.status).toBe('IN_FLIGHT');
  });

  it('prevents duplicate recovery polling from multiplying jobs using timestamp coordination', async () => {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Recovery Timestamp Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['recovery.timestamp'],
        isActive: true,
      })
      .returning();

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'recovery.timestamp',
      source: 'test-src',
      payload: {},
    });

    const [del] = await db
      .insert(deliveries)
      .values({
        projectId: testProjectId,
        eventId: event.id,
        subscriptionId: sub!.id,
        status: 'FAILED',
        attemptsCount: 1,
        maxAttempts: 5,
        nextRetryAt: new Date(Date.now() - 10000),
        updatedAt: new Date(Date.now() - 60000), // 60s ago
      })
      .returning();

    // First check finds it
    const due1 = await findDueDeliveriesForRecovery(db, 50, 30);
    const found1 = due1.find((d) => d.id === del!.id);
    expect(found1).toBeDefined();

    // Simulate recovery enqueueing and touching timestamp
    await touchDeliveryRecoveryTimestamp(db, del!.id);

    // Second check immediately afterwards: must NOT find it because grace window has not passed
    const due2 = await findDueDeliveriesForRecovery(db, 50, 30);
    const found2 = due2.find((d) => d.id === del!.id);
    expect(found2).toBeUndefined();
  });

  it('recovers failed outbox records safely with idempotent delivery creation', async () => {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Failed Outbox Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['outbox.recover'],
        isActive: true,
      })
      .returning();

    const { event, outbox } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'outbox.recover',
      source: 'test-src',
      payload: { test: 123 },
    });

    // Simulate completeOutboxRecord() failure: outbox record is marked FAILED past 5 min timeout
    await db
      .update(outboxRecords)
      .set({
        status: 'FAILED',
        attempts: 1,
        error: 'Database connection dropped during completion',
        updatedAt: new Date(Date.now() - 360 * 1000), // 6 minutes ago
      })
      .where(eq(outboxRecords.id, outbox!.id));

    // Run outbox poller: it should automatically claim the recoverable FAILED outbox record
    const claimedCount = await outboxPoller.pollOnce();
    expect(claimedCount).toBeGreaterThanOrEqual(1);

    // Verify outbox record is now PROCESSED
    const [completedOutbox] = await db
      .select()
      .from(outboxRecords)
      .where(eq(outboxRecords.id, outbox!.id));
    expect(completedOutbox!.status).toBe('PROCESSED');
    expect(completedOutbox!.processedAt).not.toBeNull();

    // Verify deliveries were created idempotently (exactly 1 delivery for this event and sub)
    const eventDeliveries = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.eventId, event.id));
    expect(eventDeliveries).toHaveLength(1);
    expect(eventDeliveries[0]!.subscriptionId).toBe(sub!.id);
  });

  it('recovers abandoned in-flight deliveries with WORKER_CRASHED attempt without reclaiming active work', async () => {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Crash Recovery Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['crash.recover'],
        isActive: true,
      })
      .returning();

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'crash.recover',
      source: 'test-src',
      payload: {},
    });

    // Active in-flight delivery (updated 10s ago; lease is 60s)
    const [activeDel] = await db
      .insert(deliveries)
      .values({
        projectId: testProjectId,
        eventId: event.id,
        subscriptionId: sub!.id,
        status: 'IN_FLIGHT',
        attemptsCount: 0,
        maxAttempts: 5,
        updatedAt: new Date(Date.now() - 10 * 1000),
      })
      .returning();

    // Stale recovery: active delivery must NOT be reclaimed
    const activeReclaimed = await recoverAbandonedInFlightDeliveries(db, 60);
    expect(activeReclaimed.find((d) => d.id === activeDel!.id)).toBeUndefined();

    // Now age delivery past 60s lease (worker died)
    await db
      .update(deliveries)
      .set({
        updatedAt: new Date(Date.now() - 75 * 1000),
      })
      .where(eq(deliveries.id, activeDel!.id));

    // Stale recovery: must reclaim abandoned delivery
    const crashedReclaimed = await recoverAbandonedInFlightDeliveries(db, 60);
    const foundCrash = crashedReclaimed.find((d) => d.id === activeDel!.id);
    expect(foundCrash).toBeDefined();
    expect(foundCrash!.status).toBe('FAILED');
    expect(foundCrash!.attemptsCount).toBe(1);

    // Verify WORKER_CRASHED attempt was recorded in delivery_attempts
    const crashAttempts = await db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, activeDel!.id));
    expect(crashAttempts).toHaveLength(1);
    expect(crashAttempts[0]!.errorCode).toBe('WORKER_CRASHED');
    expect(crashAttempts[0]!.attemptNumber).toBe(1);
    expect(crashAttempts[0]!.statusCode).toBeNull();
  });

  it('preserves accurate attempt semantics: inactive subscriptions do not count as HTTP attempts', async () => {
    // Disabled subscription
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Inactive Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['inactive.test'],
        isActive: false, // Inactive!
      })
      .returning();

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'inactive.test',
      source: 'test-src',
      payload: {},
    });

    const [del] = await db
      .insert(deliveries)
      .values({
        projectId: testProjectId,
        eventId: event.id,
        subscriptionId: sub!.id,
        status: 'PENDING',
        attemptsCount: 0,
        maxAttempts: 5,
      })
      .returning();

    // Process delivery
    await deliveryProcessor.processDelivery(del!.id);

    // Verify status is DEAD_LETTER
    const [abortedDel] = await db.select().from(deliveries).where(eq(deliveries.id, del!.id));
    expect(abortedDel!.status).toBe('DEAD_LETTER');

    // Crucial: attemptsCount remains 0 because 0 HTTP attempts were made!
    expect(abortedDel!.attemptsCount).toBe(0);

    // No fake HTTP attempt in delivery_attempts table
    const attempts = await db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, del!.id));
    expect(attempts).toHaveLength(0);
  });

  it('recovers retries from PostgreSQL following total Redis job loss', async () => {
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Redis Loss Sub',
        targetUrl: `${mockServerUrl}/webhook`,
        signingSecret: 'whsec_test',
        eventTypes: ['redis.loss'],
        isActive: true,
      })
      .returning();

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'redis.loss',
      source: 'test-src',
      payload: {},
    });

    // Delivery in FAILED status with due retry and aged updatedAt (past grace window)
    const [del] = await db
      .insert(deliveries)
      .values({
        projectId: testProjectId,
        eventId: event.id,
        subscriptionId: sub!.id,
        status: 'FAILED',
        attemptsCount: 1,
        maxAttempts: 5,
        nextRetryAt: new Date(Date.now() - 5000),
        updatedAt: new Date(Date.now() - 60000),
      })
      .returning();

    // Run recovery to restore the job to BullMQ
    const recoveredCount = await staleRecovery.recoverStaleDeliveries();
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    // Verify job exists in BullMQ with deterministic ID
    const targetJobId = `delivery-${del!.id}-2`;
    const job = await deliveryQueue.getJob(targetJobId);
    expect(job).not.toBeNull();
    expect(job!.data.deliveryId).toBe(del!.id);
  });
});
