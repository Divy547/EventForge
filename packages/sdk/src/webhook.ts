import { verifySignature, type VerifySignatureOptions } from './signature.js';
import { type EventForgeEnvelope, EVENTFORGE_HEADERS } from './envelope.js';
import { WebhookVerificationError } from './errors.js';

export interface WebhookOptions {
  /**
   * Default tolerance window in seconds for all verification calls.
   * Defaults to 300 seconds.
   */
  toleranceSeconds?: number;
}

export class EventForgeWebhook {
  private readonly defaultTolerance: number;

  constructor(options?: WebhookOptions) {
    this.defaultTolerance = options?.toleranceSeconds ?? 300;
  }

  /**
   * Verifies the cryptographic signature of an incoming webhook payload.
   */
  verify(
    payload: string | Buffer,
    signatureHeader: string,
    secret: string,
    options?: VerifySignatureOptions,
  ): boolean {
    return verifySignature(payload, signatureHeader, secret, {
      toleranceSeconds: options?.toleranceSeconds ?? this.defaultTolerance,
      clockSkewSeconds: options?.clockSkewSeconds,
    });
  }

  /**
   * Verifies signature and parses the JSON payload envelope.
   * Accepts either raw signature header string or request headers object.
   */
  constructEvent<T = Record<string, unknown>>(
    payload: string | Buffer,
    headerOrHeaders: string | Record<string, string | string[] | undefined>,
    secret: string,
    options?: VerifySignatureOptions,
  ): EventForgeEnvelope<T> {
    let signatureHeader: string | undefined;

    if (typeof headerOrHeaders === 'string') {
      signatureHeader = headerOrHeaders;
    } else if (headerOrHeaders && typeof headerOrHeaders === 'object') {
      for (const [k, v] of Object.entries(headerOrHeaders)) {
        if (k.toLowerCase() === EVENTFORGE_HEADERS.SIGNATURE) {
          signatureHeader = Array.isArray(v) ? v[0] : v;
          break;
        }
      }
    }

    if (!signatureHeader) {
      throw new WebhookVerificationError(
        'Missing required X-EventForge-Signature header',
        'MISSING_SIGNATURE',
      );
    }

    // Verify cryptographic signature and timestamp freshness
    this.verify(payload, signatureHeader, secret, options);

    // Parse verified payload into typed envelope
    const rawString = typeof payload === 'string' ? payload : payload.toString('utf8');
    try {
      const parsed = JSON.parse(rawString) as EventForgeEnvelope<T>;
      if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.event) {
        throw new WebhookVerificationError(
          'Payload is not a valid EventForge envelope (missing id or event)',
          'INVALID_PAYLOAD',
        );
      }
      return parsed;
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        throw err;
      }
      throw new WebhookVerificationError(
        `Failed to parse JSON webhook payload: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_PAYLOAD',
      );
    }
  }
}
