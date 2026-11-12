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
