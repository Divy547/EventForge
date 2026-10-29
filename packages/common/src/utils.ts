/**
 * Calculates exponential backoff delay with optional full jitter.
 *
 * @param attempt 1-based attempt count
 * @param baseDelayMs Initial backoff delay in ms (default: 1000ms)
 * @param maxDelayMs Maximum ceiling in ms (default: 24h = 86_400_000ms)
 * @param jitter Whether to apply randomized full jitter to prevent thundering herd
 */
export function calculateExponentialBackoff(
  attempt: number,
  baseDelayMs = 1000,
  maxDelayMs = 86_400_000,
  jitter = true,
): number {
  const normalizedAttempt = Math.max(1, attempt);
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, normalizedAttempt - 1));

  if (!jitter) {
    return exponential;
  }

  // Full jitter: uniformly distributed between 0 and exponential ceiling
  return Math.floor(Math.random() * exponential);
}

const SENSITIVE_KEY_REGEX = /(password|secret|token|authorization|apiKey|key)/i;

/**
 * Truncates and redacts response bodies to keep delivery attempt logs bounded and safe.
 *
 * @param body Raw response text
 * @param maxBytes Maximum characters/bytes to store (default: 2048)
 */
export function truncateAndRedact(body: string | undefined | null, maxBytes = 2048): string | null {
  if (!body) {
    return null;
  }

  let text = body.trim();
  if (text.length === 0) {
    return null;
  }

  // Attempt JSON redaction of sensitive top-level keys
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (SENSITIVE_KEY_REGEX.test(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = value;
        }
      }
      text = JSON.stringify(sanitized);
    }
  } catch {
    // Not valid JSON, keep as raw text
  }

  if (text.length > maxBytes) {
    return `${text.slice(0, maxBytes)}...[TRUNCATED]`;
  }

  return text;
}

/**
 * Matches an event type against a subscription pattern.
 * Supports:
 * - Universal wildcard: '*'
 * - Exact match: 'order.created'
 * - Prefix wildcard: 'order.*'
 */
export function matchesEventType(pattern: string, eventType: string): boolean {
  if (pattern === '*' || pattern === eventType) {
    return true;
  }

  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1); // e.g. 'order.'
    return eventType.startsWith(prefix);
  }

  return false;
}
