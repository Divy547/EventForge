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
  deliveryAttempts,
  outboxRecords,
  insertEventWithOutbox,
  type Database,
  type DeliveryRecord,
  eq,
} from '@eventforge/database';
import { verifyWebhookSignature } from '@eventforge/common';
import { WorkerModule } from '../src/worker.module.js';
import { OutboxPollerService } from '../src/outbox/outbox-poller.service.js';

describe('Worker End-to-End Integration Tests', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let outboxPoller: OutboxPollerService;

  let testProjectId: string;
  let mockServer: http.Server;
  let mockServerUrl: string;

  let lastReceivedPayload: any = null;
  let lastReceivedHeaders: http.IncomingHttpHeaders = {};
  let mockResponseStatus = 200;
  let mockResponseBody = JSON.stringify({ success: true });

  const waitForDeliveryStatus = async (
    deliveryId: string,
    targetStatus: string,
    timeoutMs = 5000,
  ): Promise<DeliveryRecord> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const [rec] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
      if (rec && rec.status === targetStatus) {
        return rec;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const [finalRec] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    return finalRec!;
  };

  beforeAll(async () => {
    process.env.ALLOW_LOCAL_WEBHOOKS = 'true';

    // 1. Initialize mock destination server
    mockServer = http.createServer((req, res) => {
      lastReceivedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          lastReceivedPayload = JSON.parse(body);
        } catch {
          lastReceivedPayload = body;
        }
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = mockResponseStatus;
        res.end(mockResponseBody);
      });
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
    db = getDatabaseConnection().db;

    // 3. Create test project in PostgreSQL
    const [project] = await db
      .insert(projects)
      .values({
        name: 'Worker Integration Project',
        slug: `worker-int-${Date.now()}`,
      })
      .returning();

    testProjectId = project!.id;
  });

  afterAll(async () => {
    // Clean up test data (cascade deletes all events, subscriptions, deliveries, attempts)
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

  it('claims outbox record, fans out to active subscription, and delivers signed payload', async () => {
    mockResponseStatus = 200;
    mockResponseBody = JSON.stringify({ acknowledged: true });

    // 1. Create active subscription
    const signingSecret = 'whsec_integration_test_secret';
    const [sub] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Order Paid Webhook',
        targetUrl: `${mockServerUrl}/webhook/orders`,
        signingSecret,
        eventTypes: ['order.*'],
        isActive: true,
      })
      .returning();

    // 2. Atomically insert event and pending outbox record
    const { event, outbox } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'order.paid',
      source: 'checkout-service',
      payload: { orderId: 'ord_12345', amountTotal: 9900 },
    });

    expect(outbox).not.toBeNull();
    expect(outbox!.status).toBe('PENDING');

    // 3. Execute outbox polling cycle
    const claimedCount = await outboxPoller.pollOnce();
    expect(claimedCount).toBeGreaterThanOrEqual(1);

    // Verify outbox record is marked PROCESSED
    const [processedOutbox] = await db
      .select()
      .from(outboxRecords)
      .where(eq(outboxRecords.id, outbox!.id));
    expect(processedOutbox!.status).toBe('PROCESSED');
    expect(processedOutbox!.processedAt).not.toBeNull();

    // Verify delivery row was created in deliveries table
    const [initialDelivery] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.eventId, event.id));
    expect(initialDelivery).toBeDefined();
    expect(initialDelivery!.subscriptionId).toBe(sub!.id);

    // 4. Wait for background BullMQ worker to automatically deliver the job
    const completedDelivery = await waitForDeliveryStatus(initialDelivery!.id, 'COMPLETED');
    expect(completedDelivery.status).toBe('COMPLETED');
    expect(completedDelivery.completedAt).not.toBeNull();
    expect(completedDelivery.attemptsCount).toBe(1);

    // Verify mock server received the webhook request
    expect(lastReceivedPayload).toBeDefined();
    expect(lastReceivedPayload.id).toBe(event.id);
    expect(lastReceivedPayload.event).toBe('order.paid');
    expect(lastReceivedPayload.source).toBe('checkout-service');
    expect(lastReceivedPayload.data).toEqual({ orderId: 'ord_12345', amountTotal: 9900 });

    // Verify headers and HMAC signature
    expect(lastReceivedHeaders['x-eventforge-event-id']).toBe(event.id);
    expect(lastReceivedHeaders['x-eventforge-delivery-id']).toBe(initialDelivery!.id);

    const sigHeader = lastReceivedHeaders['x-eventforge-signature'] as string;
    expect(sigHeader).toBeDefined();
    const isSignatureValid = verifyWebhookSignature(
      signingSecret,
      JSON.stringify(lastReceivedPayload),
      sigHeader,
    );
    expect(isSignatureValid).toBe(true);

    // Verify delivery attempt record created in delivery_attempts table
    const attempts = await db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, initialDelivery!.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.statusCode).toBe(200);
    expect(attempts[0]!.attemptNumber).toBe(1);
    expect(attempts[0]!.errorCode).toBeNull();
    expect(attempts[0]!.responseBodySnippet).toContain('acknowledged');
  });

  it('fans out single event to multiple matching subscriptions idempotently', async () => {
    mockResponseStatus = 200;
    mockResponseBody = JSON.stringify({ ok: true });

    // Create second subscription matching all events
    const [subAll] = await db
      .insert(subscriptions)
      .values({
        projectId: testProjectId,
        name: 'Catch-all Webhook',
        targetUrl: `${mockServerUrl}/webhook/all`,
        signingSecret: 'whsec_catch_all',
        eventTypes: ['*'],
        isActive: true,
      })
      .returning();

    // Insert an event matching both 'order.*' and '*'
    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'order.fulfilled',
      source: 'warehouse-service',
      payload: { trackingNumber: 'TRK-987654' },
    });

    await outboxPoller.pollOnce();

    // Verify 2 delivery records created for this single event
    const eventDeliveries = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.eventId, event.id));

    expect(eventDeliveries).toHaveLength(2);
    const subIds = eventDeliveries.map((d) => d.subscriptionId);
    expect(subIds).toContain(subAll!.id);

    // Wait for both deliveries to complete
    for (const d of eventDeliveries) {
      const res = await waitForDeliveryStatus(d.id, 'COMPLETED');
      expect(res.status).toBe('COMPLETED');
    }
  });

  it('records retry and backoff when endpoint returns transient 500 error', async () => {
    mockResponseStatus = 500;
    mockResponseBody = JSON.stringify({ error: 'Database connection failed' });

    await db.insert(subscriptions).values({
      projectId: testProjectId,
      name: 'Failing Webhook',
      targetUrl: `${mockServerUrl}/webhook/fail`,
      signingSecret: 'whsec_fail',
      eventTypes: ['system.alert'],
      isActive: true,
    });

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'system.alert',
      source: 'monitoring',
      payload: { metric: 'cpu', value: 98 },
    });

    await outboxPoller.pollOnce();

    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.eventId, event.id));
    expect(delivery).toBeDefined();

    // Wait for background worker to attempt delivery and mark it as FAILED
    const failedDelivery = await waitForDeliveryStatus(delivery!.id, 'FAILED');

    expect(failedDelivery.status).toBe('FAILED');
    expect(failedDelivery.attemptsCount).toBe(1);
    expect(failedDelivery.nextRetryAt).not.toBeNull();
    expect(new Date(failedDelivery.nextRetryAt!).getTime()).toBeGreaterThan(
      new Date(failedDelivery.createdAt).getTime(),
    );

    // Verify delivery attempt record
    const attempts = await db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, delivery!.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.statusCode).toBe(500);
    expect(attempts[0]!.errorCode).toBe('HTTP_SERVER_ERROR');
  });

  it('immediately dead-letters deliveries on non-retryable 4xx client errors', async () => {
    mockResponseStatus = 404;
    mockResponseBody = JSON.stringify({ error: 'Webhook URL not found' });

    const { event } = await insertEventWithOutbox(db, {
      projectId: testProjectId,
      eventType: 'system.alert',
      source: 'monitoring',
      payload: { metric: 'disk', value: 95 },
    });

    await outboxPoller.pollOnce();

    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.eventId, event.id));
    expect(delivery).toBeDefined();

    // Wait for background worker to attempt delivery and mark it as DEAD_LETTER
    const deadLetterDelivery = await waitForDeliveryStatus(delivery!.id, 'DEAD_LETTER');

    expect(deadLetterDelivery.status).toBe('DEAD_LETTER');
    expect(deadLetterDelivery.nextRetryAt).toBeNull();
    expect(deadLetterDelivery.attemptsCount).toBe(1);

    const attempts = await db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, delivery!.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.statusCode).toBe(404);
    expect(attempts[0]!.errorCode).toBe('HTTP_CLIENT_ERROR');
  });
});
