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
