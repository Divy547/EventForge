import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError } from './errors.js';

export interface VerifySignatureOptions {
  /**
   * Maximum allowed age of the webhook in seconds to guard against replay attacks.
   * Defaults to 300 seconds (5 minutes). Set to 0 to disable timestamp checking.
   */
  toleranceSeconds?: number | undefined;
  /**
   * Allowed future clock drift in seconds. Defaults to 5 seconds.
   */
  clockSkewSeconds?: number | undefined;
}

/**
 * Verifies the HMAC-SHA256 signature and timestamp of an incoming EventForge webhook.
 * Throws a WebhookVerificationError if verification fails.
 */
export function verifySignature(
  payload: string | Buffer,
  signatureHeader: string,
  secret: string,
  options?: VerifySignatureOptions,
): boolean {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    throw new WebhookVerificationError(
      'Missing or invalid X-EventForge-Signature header',
      'MISSING_SIGNATURE',
    );
  }

  if (!secret || typeof secret !== 'string') {
    throw new WebhookVerificationError(
      'Webhook signing secret must be provided',
      'MISSING_SIGNATURE',
    );
  }

  const parts = signatureHeader.split(',');
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const signaturePart = parts.find((p) => p.startsWith('v1='));

  if (!timestampPart || !signaturePart) {
    throw new WebhookVerificationError(
      'Malformed signature header format (expected t=...,v1=...)',
      'INVALID_FORMAT',
    );
  }

  const timestampStr = timestampPart.slice(2);
  const receivedSignature = signaturePart.slice(3);
  const timestamp = parseInt(timestampStr, 10);

  if (Number.isNaN(timestamp)) {
    throw new WebhookVerificationError(
      'Timestamp in signature is not a valid integer',
      'INVALID_FORMAT',
    );
  }

  const toleranceSeconds = options?.toleranceSeconds ?? 300;
  const clockSkewSeconds = options?.clockSkewSeconds ?? 5;
  const now = Math.floor(Date.now() / 1000);

  // Check timestamp drift to prevent replay attacks
  if (toleranceSeconds > 0) {
    if (now - timestamp > toleranceSeconds) {
      throw new WebhookVerificationError(
        `Webhook timestamp expired (age ${now - timestamp}s exceeds tolerance ${toleranceSeconds}s)`,
        'TIMESTAMP_OUT_OF_RANGE',
      );
    }
    if (timestamp - now > clockSkewSeconds) {
      throw new WebhookVerificationError(
        `Webhook timestamp is in the future (${timestamp - now}s ahead of clock skew tolerance)`,
        'TIMESTAMP_OUT_OF_RANGE',
      );
    }
  }

  const payloadString = typeof payload === 'string' ? payload : payload.toString('utf8');
  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${payloadString}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new WebhookVerificationError(
      'Webhook signature does not match computed HMAC digest',
      'SIGNATURE_MISMATCH',
    );
  }

  return true;
}
