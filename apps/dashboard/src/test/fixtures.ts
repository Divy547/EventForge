import type { Stats } from '@/lib/api';

export const statsFixture: Stats = {
  windowHours: 24,
  since: '2026-11-11T12:00:00.000Z',
  eventsTotal: 1280,
  deliveriesTotal: 2560,
  deliveriesByStatus: { PENDING: 3, IN_FLIGHT: 2, COMPLETED: 2400, FAILED: 5, DEAD_LETTER: 150 },
  successRate: 0.9411,
  recentFailures: [
    {
      deliveryId: 'd1',
      eventId: 'e1',
      eventType: 'order.created',
      subscriptionId: 's1',
      subscriptionName: 'Billing hook',
      status: 'DEAD_LETTER',
      attemptsCount: 6,
      lastStatusCode: 500,
      lastError: null,
      updatedAt: '2026-11-12T11:55:00.000Z',
    },
    {
      deliveryId: 'd2',
      eventId: 'e2',
      eventType: 'user.deleted',
      subscriptionId: 's2',
      subscriptionName: 'CRM sync',
      status: 'FAILED',
      attemptsCount: 1,
      lastStatusCode: null,
      lastError: 'connect ECONNREFUSED',
      updatedAt: '2026-11-12T11:00:00.000Z',
    },
  ],
};

export function statsResponse(overrides: Partial<typeof statsFixture> = {}): Response {
  return new Response(JSON.stringify({ ...statsFixture, ...overrides }), { status: 200 });
}

import type { EventPage, EventRecord, EventWithDeliveries } from '@/lib/api';

export const eventFixture: EventRecord = {
  id: '11111111-aaaa-4bbb-8ccc-222222222222',
  projectId: 'p1',
  idempotencyKey: 'idem-1',
  eventType: 'order.created',
  source: 'billing-service',
  payload: { orderId: 'ord_123', amount: 99.99 },
  metadata: { traceId: 'tr_abc' },
  createdAt: '2026-11-12T11:55:00.000Z',
};

export function eventsPage(
  data: EventRecord[] = [eventFixture],
  meta: Partial<EventPage['meta']> = {},
): Response {
  const total = meta.total ?? data.length;
  return new Response(
    JSON.stringify({ data, meta: { total, page: 1, limit: 20, totalPages: 1, ...meta } }),
    { status: 200 },
  );
}

export const eventDetailFixture: EventWithDeliveries = {
  ...eventFixture,
  deliveries: [
    {
      id: 'd1',
      subscriptionId: 's1',
      subscriptionName: 'Billing hook',
      status: 'COMPLETED',
      attemptsCount: 2,
      maxAttempts: 6,
      nextRetryAt: null,
      completedAt: '2026-11-12T11:56:00.000Z',
      createdAt: '2026-11-12T11:55:00.000Z',
      updatedAt: '2026-11-12T11:56:00.000Z',
    },
    {
      id: 'd2',
      subscriptionId: 's2',
      subscriptionName: 'CRM sync',
      status: 'DEAD_LETTER',
      attemptsCount: 6,
      maxAttempts: 6,
      nextRetryAt: null,
      completedAt: null,
      createdAt: '2026-11-12T11:55:00.000Z',
      updatedAt: '2026-11-12T11:58:00.000Z',
    },
  ],
};

export function eventDetailResponse(): Response {
  return new Response(JSON.stringify(eventDetailFixture), { status: 200 });
}

import type { DeliveryDetail, DeliveryPage, DeliverySummary } from '@/lib/api';

export const deliverySummaryFixture: DeliverySummary = {
  id: 'dddddddd-1111-4222-8333-444444444444',
  projectId: 'p1',
  eventId: eventFixture.id,
  subscriptionId: 's1',
  status: 'DEAD_LETTER',
  attemptsCount: 6,
  maxAttempts: 6,
  nextRetryAt: null,
  completedAt: null,
  createdAt: '2026-11-12T11:55:00.000Z',
  updatedAt: '2026-11-12T11:58:00.000Z',
};

export function deliveriesPage(
  data: DeliverySummary[] = [deliverySummaryFixture],
  meta: Partial<DeliveryPage['meta']> = {},
): Response {
  const total = meta.total ?? data.length;
  return new Response(
    JSON.stringify({ data, meta: { total, page: 1, limit: 20, totalPages: 1, ...meta } }),
    { status: 200 },
  );
}

export const deliveryDetailFixture: DeliveryDetail = {
  ...deliverySummaryFixture,
  event: {
    id: eventFixture.id,
    eventType: 'order.created',
    source: 'billing-service',
    createdAt: eventFixture.createdAt,
  },
  subscription: {
    id: 's1',
    name: 'Billing hook',
    targetUrl: 'https://hooks.example.com/in',
    isActive: true,
  },
  attempts: [
    {
      id: 'a1',
      attemptNumber: 1,
      statusCode: 503,
      responseBodySnippet: 'upstream unavailable',
      executionDurationMs: 120,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-11-12T11:55:05.000Z',
    },
    {
      id: 'a2',
      attemptNumber: 2,
      statusCode: null,
      responseBodySnippet: null,
      executionDurationMs: 5000,
      errorCode: 'ETIMEDOUT',
      errorMessage: 'request timed out',
      createdAt: '2026-11-12T11:55:15.000Z',
    },
    {
      id: 'a3',
      attemptNumber: 3,
      statusCode: 200,
      responseBodySnippet: null,
      executionDurationMs: 80,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-11-12T11:56:00.000Z',
    },
  ],
};
