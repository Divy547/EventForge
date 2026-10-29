import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hashes an API key using SHA-256 for secure storage.
 * Never store plaintext API keys in the database.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generates a cryptographically secure API key.
 * Returns the raw key (shown to user once), prefix for fast identification,
 * and SHA-256 hash for database storage.
 */
export function generateApiKey(prefix = 'ef_live'): {
  rawKey: string;
  keyPrefix: string;
  hashedKey: string;
} {
  const secretBytes = randomBytes(24).toString('base64url');
  const rawKey = `${prefix}_${secretBytes}`;
  const keyPrefix = `${prefix}_${secretBytes.slice(0, 7)}`;
  const hashedKey = hashApiKey(rawKey);

  return {
    rawKey,
    keyPrefix,
    hashedKey,
  };
}

/**
 * Generates a random webhook signing secret.
 */
export function generateSigningSecret(prefix = 'whsec'): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

/**
 * Signs a webhook payload using HMAC-SHA256.
 * Signature format: `t=${timestamp},v1=${signature}`
 */
export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verifies a webhook signature header against a secret and payload.
 * Guards against timing attacks using constant-time comparison.
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  header: string,
  toleranceSeconds = 300,
): boolean {
  if (!header || !secret) {
    return false;
  }

  const parts = header.split(',');
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const signaturePart = parts.find((p) => p.startsWith('v1='));

  if (!timestampPart || !signaturePart) {
    return false;
  }

  const timestampStr = timestampPart.slice(2);
  const receivedSignature = signaturePart.slice(3);
  const timestamp = parseInt(timestampStr, 10);

  if (Number.isNaN(timestamp)) {
    return false;
  }

  // Check timestamp drift to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
