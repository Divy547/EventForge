export type WebhookErrorCode =
  | 'MISSING_SIGNATURE'
  | 'INVALID_FORMAT'
  | 'TIMESTAMP_OUT_OF_RANGE'
  | 'SIGNATURE_MISMATCH'
  | 'INVALID_PAYLOAD';

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: WebhookErrorCode,
  ) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}
