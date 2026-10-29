import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DeliveryProcessor } from '../src/delivery/delivery.processor.js';
import { WorkerConfigService } from '../src/config/worker-config.service.js';
import { WorkerDatabaseService } from '../src/database/worker-database.service.js';
import {
  HttpDispatcherService,
  WebhookDispatchError,
} from '../src/delivery/http-dispatcher.service.js';

describe('DeliveryProcessor', () => {
  let processor: DeliveryProcessor;
  let mockDbService: { [K in keyof WorkerDatabaseService]?: jest.Mock<any> };
  let mockQueue: { [K in keyof Queue]?: jest.Mock<any> };
  let mockRedis: { [K in keyof Redis]?: jest.Mock<any> };
  let mockConfig: Partial<WorkerConfigService>;
  let mockDispatcher: { [K in keyof HttpDispatcherService]?: jest.Mock<any> };

  const fakeDelivery = {
    id: 'del-1',
    projectId: 'proj-1',
    eventId: 'evt-1',
    subscriptionId: 'sub-1',
    status: 'IN_FLIGHT' as const,
    attemptsCount: 0,
    maxAttempts: 5,
    nextRetryAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeEvent = {
    id: 'evt-1',
    projectId: 'proj-1',
    eventType: 'order.created',
    source: 'web',
    payload: { id: 1 },
    metadata: {},
    idempotencyKey: null,
    createdAt: new Date(),
  };

  const fakeSubscription = {
    id: 'sub-1',
    projectId: 'proj-1',
    name: 'Customer Webhook',
    targetUrl: 'https://example.com/webhook',
    signingSecret: 'whsec_secret',
    eventTypes: ['order.*'],
    isActive: true,
    rateLimitPerSecond: null,
    headers: { 'X-Custom-Auth': 'Bearer token' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockConfig = {
      workerConcurrency: 5,
      deliveryLeaseTimeoutSeconds: 60,
    };

    mockQueue = {
      add: jest.fn<any>().mockResolvedValue({ id: 'job-1' }),
    };

    mockRedis = {
      on: jest.fn<any>(),
    };

    mockDbService = {
      claimDeliveryForProcessing: jest.fn<any>(),
      getDeliveryContext: jest.fn<any>(),
      recordSuccessfulDelivery: jest.fn<any>(),
      recordFailedDelivery: jest.fn<any>(),
      recordDeliveryAborted: jest.fn<any>(),
    };

    mockDispatcher = {
      dispatch: jest.fn<any>(),
    };

    processor = new DeliveryProcessor(
      mockDbService as unknown as WorkerDatabaseService,
      mockRedis as unknown as Redis,
      mockQueue as unknown as Queue,
      mockConfig as WorkerConfigService,
      mockDispatcher as unknown as HttpDispatcherService,
    );
  });

  it('skips processing if delivery cannot be claimed', async () => {
    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(null);

    await processor.processDelivery('del-already-done');

    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
    expect(mockDbService.recordSuccessfulDelivery).not.toHaveBeenCalled();
    expect(mockDbService.recordFailedDelivery).not.toHaveBeenCalled();
  });

  it('aborts delivery without counting HTTP attempt when subscription is inactive', async () => {
    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(fakeDelivery);
    mockDbService.getDeliveryContext!.mockResolvedValue({
      delivery: fakeDelivery,
      event: fakeEvent,
      subscription: { ...fakeSubscription, isActive: false },
    });

    await processor.processDelivery('del-1');

    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
    expect(mockDbService.recordDeliveryAborted).toHaveBeenCalledWith('del-1');
    expect(mockDbService.recordSuccessfulDelivery).not.toHaveBeenCalled();
    expect(mockDbService.recordFailedDelivery).not.toHaveBeenCalled();
  });

  it('marks delivery as completed upon successful 2xx HTTP response', async () => {
    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(fakeDelivery);
    mockDbService.getDeliveryContext!.mockResolvedValue({
      delivery: fakeDelivery,
      event: fakeEvent,
      subscription: fakeSubscription,
    });

    mockDispatcher.dispatch!.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      bodySnippet: '{"ok":true}',
      durationMs: 45,
    });

    await processor.processDelivery('del-1');

    expect(mockDispatcher.dispatch).toHaveBeenCalledWith({
      targetUrl: 'https://example.com/webhook',
      payloadString: expect.stringContaining('"event":"order.created"'),
      signingSecret: 'whsec_secret',
      deliveryId: 'del-1',
      eventId: 'evt-1',
      customHeaders: { 'X-Custom-Auth': 'Bearer token' },
    });

    expect(mockDbService.recordSuccessfulDelivery).toHaveBeenCalledWith({
      deliveryId: 'del-1',
      attemptNumber: 1,
      statusCode: 200,
      responseHeaders: { 'content-type': 'application/json' },
      responseBodySnippet: '{"ok":true}',
      executionDurationMs: 45,
    });

    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('re-enqueues delivery with exponential backoff on retryable 500 server error', async () => {
    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(fakeDelivery);
    mockDbService.getDeliveryContext!.mockResolvedValue({
      delivery: fakeDelivery,
      event: fakeEvent,
      subscription: fakeSubscription,
    });

    mockDispatcher.dispatch!.mockRejectedValue(
      new WebhookDispatchError(
        'Server error',
        'HTTP_SERVER_ERROR',
        500,
        120,
        null,
        'Internal Error',
      ),
    );

    await processor.processDelivery('del-1');

    expect(mockDbService.recordFailedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-1',
        attemptNumber: 1,
        statusCode: 500,
        isRetryable: true,
        nextRetryAt: expect.any(Date),
      }),
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      'deliver',
      { deliveryId: 'del-1' },
      expect.objectContaining({ delay: expect.any(Number), jobId: 'delivery-del-1-2' }),
    );
  });

  it('parses Retry-After header and applies delay on 429 response', async () => {
    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(fakeDelivery);
    mockDbService.getDeliveryContext!.mockResolvedValue({
      delivery: fakeDelivery,
      event: fakeEvent,
      subscription: fakeSubscription,
    });

    mockDispatcher.dispatch!.mockRejectedValue(
      new WebhookDispatchError(
        'Rate limited',
        'HTTP_CLIENT_ERROR',
        429,
        50,
        { 'retry-after': '10' },
        'Too many requests',
      ),
    );

    await processor.processDelivery('del-1');

    expect(mockDbService.recordFailedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-1',
        statusCode: 429,
        isRetryable: true,
      }),
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      'deliver',
      { deliveryId: 'del-1' },
      expect.objectContaining({ delay: 10000, jobId: 'delivery-del-1-2' }),
    );
  });

  it('immediately marks 4xx non-retryable client error as DEAD_LETTER', async () => {
    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(fakeDelivery);
    mockDbService.getDeliveryContext!.mockResolvedValue({
      delivery: fakeDelivery,
      event: fakeEvent,
      subscription: fakeSubscription,
    });

    mockDispatcher.dispatch!.mockRejectedValue(
      new WebhookDispatchError(
        'Bad request',
        'HTTP_CLIENT_ERROR',
        400,
        30,
        null,
        'Invalid payload',
      ),
    );

    await processor.processDelivery('del-1');

    expect(mockDbService.recordFailedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-1',
        statusCode: 400,
        isRetryable: false,
      }),
    );

    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('immediately marks SSRF blocked attempts as DEAD_LETTER', async () => {
    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(fakeDelivery);
    mockDbService.getDeliveryContext!.mockResolvedValue({
      delivery: fakeDelivery,
      event: fakeEvent,
      subscription: fakeSubscription,
    });

    mockDispatcher.dispatch!.mockRejectedValue(
      new WebhookDispatchError('SSRF blocked', 'SSRF_BLOCKED', null, 5),
    );

    await processor.processDelivery('del-1');

    expect(mockDbService.recordFailedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-1',
        errorCode: 'SSRF_BLOCKED',
        isRetryable: false,
      }),
    );

    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('marks delivery as DEAD_LETTER when maximum retry attempts are exhausted', async () => {
    const exhaustedDelivery = {
      ...fakeDelivery,
      attemptsCount: 4,
      maxAttempts: 5,
    };

    mockDbService.claimDeliveryForProcessing!.mockResolvedValue(exhaustedDelivery);
    mockDbService.getDeliveryContext!.mockResolvedValue({
      delivery: exhaustedDelivery,
      event: fakeEvent,
      subscription: fakeSubscription,
    });

    mockDispatcher.dispatch!.mockRejectedValue(
      new WebhookDispatchError('Timeout', 'TIMEOUT', null, 10000),
    );

    await processor.processDelivery('del-1');

    expect(mockDbService.recordFailedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-1',
        attemptNumber: 5,
        errorCode: 'TIMEOUT',
        isRetryable: false,
      }),
    );

    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
