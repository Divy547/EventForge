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

export type StatsResult =
  | { ok: true; stats: Stats }
  | { ok: false; reason: 'unauthorized' | 'rate-limited' | 'unreachable' | 'unexpected' };

export async function fetchStats(
  key: string,
  windowHours: number,
  signal?: AbortSignal,
): Promise<StatsResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/stats?windowHours=${windowHours}`, {
      headers: { 'X-API-Key': key },
      signal: signal ?? null,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (response.status === 401) return { ok: false, reason: 'unauthorized' };
  if (response.status === 429) return { ok: false, reason: 'rate-limited' };
  if (!response.ok) return { ok: false, reason: 'unexpected' };
  try {
    return { ok: true, stats: (await response.json()) as Stats };
  } catch {
    return { ok: false, reason: 'unexpected' };
  }
}
