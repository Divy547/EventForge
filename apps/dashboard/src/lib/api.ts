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
  'unauthorized' | 'not-found' | 'conflict' | 'rate-limited' | 'unreachable' | 'unexpected';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: ApiFailure };

function failureForStatus(status: number): ApiFailure {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate-limited';
  return 'unexpected';
}

/** One place that maps transport and HTTP problems onto the failures the pages know how to show. */
async function getJson<T>(path: string, key: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { 'X-API-Key': key }, signal: signal ?? null });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!response.ok) return { ok: false, reason: failureForStatus(response.status) };
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, reason: 'unexpected' };
  }
}

/** A write the API refused with 400: `message` is its own explanation (validation, SSRF, ...). */
export type MutationResult<T> = ApiResult<T> | { ok: false; reason: 'rejected'; message: string };

/**
 * The API answers a 400 as RFC 7807 problem details: `detail` is a sentence (the SSRF reason, or a
 * generic "validation failed") and `errors` lists the specific field problems when there are any.
 */
async function readRejection(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; errors?: unknown };
    if (Array.isArray(body.errors) && body.errors.length > 0) return body.errors.join('; ');
    if (typeof body.detail === 'string' && body.detail) return body.detail;
  } catch {
    // Fall through to the generic wording.
  }
  return 'The API rejected these values.';
}

async function sendJson<T>(
  method: 'POST' | 'PATCH',
  path: string,
  key: string,
  body: unknown,
): Promise<MutationResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (response.status === 400) {
    return { ok: false, reason: 'rejected', message: await readRejection(response) };
  }
  if (!response.ok) return { ok: false, reason: failureForStatus(response.status) };
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

/** Mirrors `DeliverySummaryResponseDto`. The list carries IDs only; names are on the detail. */
export interface DeliverySummary {
  id: string;
  projectId: string;
  eventId: string;
  subscriptionId: string;
  status: DeliveryStatus;
  attemptsCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `PaginatedDeliveriesResponseDto`. */
export interface DeliveryPage {
  data: DeliverySummary[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Mirrors `DeliveryAttemptResponseDto`. */
export interface DeliveryAttempt {
  id: string;
  attemptNumber: number;
  statusCode: number | null;
  responseBodySnippet: string | null;
  executionDurationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** Mirrors `DeliveryDetailResponseDto`. `event` and `subscription` are absent if since deleted. */
export interface DeliveryDetail extends DeliverySummary {
  event?: { id: string; eventType: string; source: string; createdAt: string } | undefined;
  subscription?: { id: string; name: string; targetUrl: string; isActive: boolean } | undefined;
  attempts: DeliveryAttempt[];
}

export const DELIVERY_STATUSES: DeliveryStatus[] = [
  'DEAD_LETTER',
  'FAILED',
  'PENDING',
  'IN_FLIGHT',
  'COMPLETED',
];

/** The API lists one status at a time and falls back to dead letters when none is sent. */
export const DEFAULT_DELIVERY_STATUS: DeliveryStatus = 'DEAD_LETTER';

export const DELIVERIES_PAGE_SIZE = 20;

export function fetchDeliveries(
  key: string,
  query: { page: number; status: DeliveryStatus },
  signal?: AbortSignal,
): Promise<ApiResult<DeliveryPage>> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(DELIVERIES_PAGE_SIZE),
    status: query.status,
  });
  return getJson<DeliveryPage>(`/v1/deliveries?${params.toString()}`, key, signal);
}

export function fetchDelivery(
  key: string,
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<DeliveryDetail>> {
  return getJson<DeliveryDetail>(`/v1/deliveries/${encodeURIComponent(id)}`, key, signal);
}

/** Mirrors `SubscriptionResponseDto`. The signing secret is never part of a read. */
export interface Subscription {
  id: string;
  projectId: string;
  name: string;
  targetUrl: string;
  eventTypes: string[];
  isActive: boolean;
  rateLimitPerSecond: number | null;
  headers: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `CreatedSubscriptionResponseDto`: the only response that carries the secret. */
export interface CreatedSubscription extends Subscription {
  signingSecret: string;
}

/** Mirrors `CreateSubscriptionDto`. */
export interface SubscriptionInput {
  name: string;
  targetUrl: string;
  eventTypes: string[];
  rateLimitPerSecond?: number;
}

/** Mirrors `UpdateSubscriptionDto`. The API cannot clear a rate limit once set, only change it. */
export type SubscriptionPatch = Partial<SubscriptionInput> & { isActive?: boolean };

export function fetchSubscriptions(
  key: string,
  signal?: AbortSignal,
): Promise<ApiResult<Subscription[]>> {
  return getJson<Subscription[]>('/v1/subscriptions', key, signal);
}

export function createSubscription(
  key: string,
  input: SubscriptionInput,
): Promise<MutationResult<CreatedSubscription>> {
  return sendJson<CreatedSubscription>('POST', '/v1/subscriptions', key, input);
}

export function updateSubscription(
  key: string,
  id: string,
  patch: SubscriptionPatch,
): Promise<MutationResult<Subscription>> {
  return sendJson<Subscription>('PATCH', `/v1/subscriptions/${encodeURIComponent(id)}`, key, patch);
}

/** Mirrors `ReplaySingleResponseDto`. */
export interface ReplayResult {
  delivery: DeliverySummary;
  replayed: boolean;
  message: string;
}

/** Mirrors `ReplayBatchResponseDto`: one entry per requested delivery, success or not. */
export interface BatchReplayResult {
  totalRequested: number;
  replayedCount: number;
  failedCount: number;
  items: { deliveryId: string; success: boolean; status?: string; error?: string }[];
}

/** Moves one dead-letter delivery back to PENDING with fresh attempts (API default: 3 more). */
export function replayDelivery(key: string, id: string): Promise<MutationResult<ReplayResult>> {
  return sendJson<ReplayResult>('POST', `/v1/deliveries/${encodeURIComponent(id)}/replay`, key, {});
}

/** The API accepts at most 50 IDs per request; the page lists 20, so one call covers a page. */
export function replayDeliveries(
  key: string,
  deliveryIds: string[],
): Promise<MutationResult<BatchReplayResult>> {
  return sendJson<BatchReplayResult>('POST', '/v1/deliveries/replay', key, { deliveryIds });
}

/** Visitor-facing wording for every failure a page can hit. */
export const FAILURE_MESSAGES: Record<ApiFailure, string> = {
  unauthorized: 'Your API key was not accepted. Sign in again.',
  'not-found': 'That item does not exist in this project.',
  conflict: 'That delivery is no longer a dead letter. Refresh the list.',
  'rate-limited': 'Too many requests. Wait a moment and refresh.',
  unreachable: 'Could not reach the API. Check your connection and refresh.',
  unexpected: 'The API returned an unexpected response. Try again shortly.',
};

/** Mirrors `SandboxSessionResponseDto`. */
export interface SandboxSession {
  apiKey: string;
  expiresAt: string;
}

export type SandboxStart =
  | { ok: true; session: SandboxSession }
  | { ok: false; reason: 'disabled' | 'rate-limited' | 'unreachable' | 'unexpected' };

/** Asks the API for a short-lived key to the shared sandbox project. Needs no credentials. */
export async function startSandboxSession(signal?: AbortSignal): Promise<SandboxStart> {
  let response: Response;
  try {
    response = await fetch('/v1/sandbox/session', { method: 'POST', signal: signal ?? null });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (response.status === 404) return { ok: false, reason: 'disabled' };
  if (response.status === 429) return { ok: false, reason: 'rate-limited' };
  if (!response.ok) return { ok: false, reason: 'unexpected' };
  try {
    return { ok: true, session: (await response.json()) as SandboxSession };
  } catch {
    return { ok: false, reason: 'unexpected' };
  }
}

export type SandboxScenario = 'succeed' | 'flaky' | 'fail' | 'slow';

/** Mirrors `SendSandboxEventResponseDto`. */
export interface SandboxSend {
  eventId: string;
  scenario: SandboxScenario;
  eventType: string;
}

export function sendSandboxEvent(
  key: string,
  scenario: SandboxScenario,
): Promise<MutationResult<SandboxSend>> {
  return sendJson<SandboxSend>('POST', '/v1/sandbox/events', key, { scenario });
}
