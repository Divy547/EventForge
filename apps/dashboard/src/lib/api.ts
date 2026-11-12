export type KeyCheck =
  { ok: true } | { ok: false; reason: 'invalid' | 'rate-limited' | 'unreachable' | 'unexpected' };

/**
 * Asks the API whether a key is accepted by calling the cheapest authenticated, project-scoped
 * endpoint. Nothing is stored here; the caller decides what to do with the result.
 */
export async function checkApiKey(key: string, signal?: AbortSignal): Promise<KeyCheck> {
  let response: Response;
  try {
    response = await fetch('/v1/stats?windowHours=1', {
      headers: { 'X-API-Key': key },
      signal: signal ?? null,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (response.ok) return { ok: true };
  if (response.status === 401) return { ok: false, reason: 'invalid' };
  if (response.status === 429) return { ok: false, reason: 'rate-limited' };
  return { ok: false, reason: 'unexpected' };
}

export type DeliveryStatus = 'PENDING' | 'IN_FLIGHT' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';

export interface RecentFailure {
  deliveryId: string;
  eventId: string;
  eventType: string;
  subscriptionId: string;
  subscriptionName: string;
  /** FAILED (will retry) or DEAD_LETTER. */
  status: string;
  attemptsCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  updatedAt: string;
}

/** Mirrors `StatsResponseDto` in the API. */
export interface Stats {
  windowHours: number;
  since: string;
  eventsTotal: number;
  deliveriesTotal: number;
  deliveriesByStatus: Record<DeliveryStatus, number>;
  /** Fraction 0..1, or null while nothing has reached a final state. */
  successRate: number | null;
  recentFailures: RecentFailure[];
}

export type ApiFailure =
  'unauthorized' | 'not-found' | 'rate-limited' | 'unreachable' | 'unexpected';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: ApiFailure };

/** One place that maps transport and HTTP problems onto the failures the pages know how to show. */
async function getJson<T>(path: string, key: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { 'X-API-Key': key }, signal: signal ?? null });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (response.status === 401) return { ok: false, reason: 'unauthorized' };
  if (response.status === 404) return { ok: false, reason: 'not-found' };
  if (response.status === 429) return { ok: false, reason: 'rate-limited' };
  if (!response.ok) return { ok: false, reason: 'unexpected' };
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, reason: 'unexpected' };
  }
}

export function fetchStats(
  key: string,
  windowHours: number,
  signal?: AbortSignal,
): Promise<ApiResult<Stats>> {
  return getJson<Stats>(`/v1/stats?windowHours=${windowHours}`, key, signal);
}

/** Mirrors `EventDetailResponseDto`. */
export interface EventRecord {
  id: string;
  projectId: string;
  idempotencyKey: string | null;
  eventType: string;
  source: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Mirrors `EventDeliverySummaryDto`. */
export interface EventDelivery {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  status: DeliveryStatus;
  attemptsCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventWithDeliveries extends EventRecord {
  deliveries: EventDelivery[];
}

/** Mirrors `PaginatedEventsResponseDto`. */
export interface EventPage {
  data: EventRecord[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface EventFilters {
  page: number;
  eventType?: string | undefined;
  source?: string | undefined;
  /** ISO timestamps; the API treats both ends as inclusive. */
  from?: string | undefined;
  to?: string | undefined;
}

export const EVENTS_PAGE_SIZE = 20;

export function fetchEvents(
  key: string,
  filters: EventFilters,
  signal?: AbortSignal,
): Promise<ApiResult<EventPage>> {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(EVENTS_PAGE_SIZE),
  });
  for (const name of ['eventType', 'source', 'from', 'to'] as const) {
    const value = filters[name];
    if (value) params.set(name, value);
  }
  return getJson<EventPage>(`/v1/events?${params.toString()}`, key, signal);
}

export function fetchEvent(
  key: string,
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<EventWithDeliveries>> {
  return getJson<EventWithDeliveries>(`/v1/events/${encodeURIComponent(id)}`, key, signal);
}

/** Visitor-facing wording for every failure a page can hit. */
export const FAILURE_MESSAGES: Record<ApiFailure, string> = {
  unauthorized: 'Your API key was not accepted. Sign in again.',
  'not-found': 'That item does not exist in this project.',
  'rate-limited': 'Too many requests. Wait a moment and refresh.',
  unreachable: 'Could not reach the API. Check your connection and refresh.',
  unexpected: 'The API returned an unexpected response. Try again shortly.',
};
