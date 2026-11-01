import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Queue } from 'bullmq';
import { OutboxPollerService } from '../src/outbox/outbox-poller.service.js';
import { WorkerConfigService } from '../src/config/worker-config.service.js';
import { WorkerDatabaseService } from '../src/database/worker-database.service.js';

describe('OutboxPollerService', () => {
  let poller: OutboxPollerService;
  let mockDbService: { [K in keyof WorkerDatabaseService]?: jest.Mock<any> };
  let mockQueue: { [K in keyof Queue]?: jest.Mock<any> };
  let mockConfig: Partial<WorkerConfigService>;

  beforeEach(() => {
    mockConfig = {
      outboxBatchSize: 10,
      outboxPollIntervalMs: 1000,
    };

    mockQueue = {
      add: jest.fn<any>().mockResolvedValue({ id: 'job-1' }),
    };

    mockDbService = {
      claimPendingOutboxRecords: jest.fn<any>(),
      getEvent: jest.fn<any>(),
      getActiveSubscriptions: jest.fn<any>(),
      createDeliveriesForEvent: jest.fn<any>(),
      completeOutboxRecord: jest.fn<any>(),
      failOutboxRecord: jest.fn<any>(),
      recordFailedOutboxAttempt: jest
        .fn<any>()
        .mockResolvedValue({ id: 'outbox-1', status: 'FAILED', attempts: 1 }),
    };

    poller = new OutboxPollerService(
      mockDbService as unknown as WorkerDatabaseService,
      mockQueue as unknown as Queue,
      mockConfig as WorkerConfigService,
    );
  });

  it('returns 0 when no outbox records are claimed', async () => {
    mockDbService.claimPendingOutboxRecords!.mockResolvedValue([]);

    const count = await poller.pollOnce();

    expect(count).toBe(0);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('matches subscriptions, creates deliveries, enqueues jobs, and completes outbox record', async () => {
    const fakeOutboxRecord = {
      id: 'outbox-1',
      eventId: 'evt-100',
      status: 'PROCESSING' as const,
      attempts: 1,
      claimedBy: 'worker-1',
      claimedAt: new Date(),
      processedAt: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const fakeEvent = {
      id: 'evt-100',
      projectId: 'proj-1',
      eventType: 'order.created',
      source: 'web',
      payload: { orderId: '123' },
      metadata: {},
      idempotencyKey: null,
      createdAt: new Date(),
    };

    const fakeSubscriptions = [
      {
        id: 'sub-1',
        projectId: 'proj-1',
        name: 'Order Wildcard',
        targetUrl: 'https://example.com/orders',
        signingSecret: 'sec-1',
        eventTypes: ['order.*'],
        isActive: true,
        rateLimitPerSecond: null,
        headers: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'sub-2',
        projectId: 'proj-1',
        name: 'User Only',
        targetUrl: 'https://example.com/users',
        signingSecret: 'sec-2',
        eventTypes: ['user.*'],
        isActive: true,
        rateLimitPerSecond: null,
        headers: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'sub-3',
        projectId: 'proj-1',
        name: 'All Events',
        targetUrl: 'https://example.com/all',
        signingSecret: 'sec-3',
        eventTypes: ['*'],
        isActive: true,
        rateLimitPerSecond: null,
        headers: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const fakeDeliveries = [
      {
        id: 'del-1',
        projectId: 'proj-1',
        eventId: 'evt-100',
        subscriptionId: 'sub-1',
        status: 'PENDING' as const,
        attemptsCount: 0,
        maxAttempts: 5,
        nextRetryAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'del-3',
        projectId: 'proj-1',
        eventId: 'evt-100',
        subscriptionId: 'sub-3',
        status: 'PENDING' as const,
        attemptsCount: 0,
        maxAttempts: 5,
        nextRetryAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockDbService.claimPendingOutboxRecords!.mockResolvedValue([fakeOutboxRecord]);
    mockDbService.getEvent!.mockResolvedValue(fakeEvent);
    mockDbService.getActiveSubscriptions!.mockResolvedValue(fakeSubscriptions);
    mockDbService.createDeliveriesForEvent!.mockResolvedValue(fakeDeliveries);
    mockDbService.completeOutboxRecord!.mockResolvedValue(undefined);

    const count = await poller.pollOnce();

    expect(count).toBe(1);

    // sub-1 (order.*) and sub-3 (*) should match; sub-2 (user.*) must not match
    expect(mockDbService.createDeliveriesForEvent).toHaveBeenCalledWith({
      projectId: 'proj-1',
      eventId: 'evt-100',
      subscriptionIds: ['sub-1', 'sub-3'],
    });

    // Verify BullMQ jobs enqueued for both deliveries with deterministic attempt-based ID
    expect(mockQueue.add).toHaveBeenCalledTimes(2);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'deliver',
      { deliveryId: 'del-1', traceparent: undefined, tracestate: undefined },
      { jobId: 'delivery-del-1-1' },
    );
    expect(mockQueue.add).toHaveBeenCalledWith(
      'deliver',
      { deliveryId: 'del-3', traceparent: undefined, tracestate: undefined },
      { jobId: 'delivery-del-3-1' },
    );

    // Verify outbox completed
    expect(mockDbService.completeOutboxRecord).toHaveBeenCalledWith('outbox-1');
  });

  it('marks outbox record as failed when event is not found in database', async () => {
    const fakeOutboxRecord = {
      id: 'outbox-missing',
      eventId: 'evt-nonexistent',
      status: 'PROCESSING' as const,
      attempts: 1,
      claimedBy: 'worker-1',
      claimedAt: new Date(),
      processedAt: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDbService.claimPendingOutboxRecords!.mockResolvedValue([fakeOutboxRecord]);
    mockDbService.getEvent!.mockResolvedValue(null);

    const count = await poller.pollOnce();

    expect(count).toBe(1);
    expect(mockDbService.recordFailedOutboxAttempt).toHaveBeenCalledWith(
      'outbox-missing',
      expect.stringContaining('Event evt-nonexistent not found'),
      10,
    );
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('transitions outbox record to DEAD_LETTER when maximum retry attempts are exhausted', async () => {
    const exhaustedRecord = {
      id: 'outbox-exhausted',
      eventId: 'evt-exhausted',
      status: 'PROCESSING' as const,
      attempts: 10,
      claimedBy: 'worker-1',
      claimedAt: new Date(),
      processedAt: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDbService.claimPendingOutboxRecords!.mockResolvedValue([exhaustedRecord]);
    mockDbService.getEvent!.mockRejectedValue(new Error('Fatal database disk failure'));
    mockDbService.recordFailedOutboxAttempt!.mockResolvedValue({
      id: 'outbox-exhausted',
      status: 'DEAD_LETTER',
      attempts: 10,
    });

    const count = await poller.pollOnce();

    expect(count).toBe(1);
    expect(mockDbService.recordFailedOutboxAttempt).toHaveBeenCalledWith(
      'outbox-exhausted',
      'Fatal database disk failure',
      10,
    );
  });
});
