/**
 * API Key lifecycle states.
 */
export const ApiKeyStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;

export type ApiKeyStatus = (typeof ApiKeyStatus)[keyof typeof ApiKeyStatus];

/**
 * Logical delivery lifecycle states.
 */
export const DeliveryStatus = {
  PENDING: 'PENDING',
  IN_FLIGHT: 'IN_FLIGHT',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER',
} as const;

export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

/**
 * Outbox record processing states.
 */
export const OutboxStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
} as const;

export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

/**
 * Tenant project boundary.
 */
export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Project API key entity (hashed key only).
 */
export interface ApiKey {
  id: string;
  projectId: string;
  keyPrefix: string;
  hashedKey: string;
  name: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * Ingested business event (immutable).
 */
export interface Event<TPayload = Record<string, unknown>, TMetadata = Record<string, unknown>> {
  id: string;
  projectId: string;
  idempotencyKey: string | null;
  eventType: string;
  source: string;
  payload: TPayload;
  metadata: TMetadata;
  createdAt: Date;
}

/**
 * Destination webhook subscription.
 */
export interface Subscription {
  id: string;
  projectId: string;
  name: string;
  targetUrl: string;
  signingSecret: string;
  eventTypes: string[];
  isActive: boolean;
  rateLimitPerSecond: number | null;
  headers: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Logical delivery: contract matching one event to one subscription.
 */
export interface Delivery {
  id: string;
  projectId: string;
  eventId: string;
  subscriptionId: string;
  status: DeliveryStatus;
  attemptsCount: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Delivery attempt: immutable execution audit.
 */
export interface DeliveryAttempt {
  id: string;
  deliveryId: string;
  attemptNumber: number;
  statusCode: number | null;
  responseHeaders: Record<string, string> | null;
  responseBodySnippet: string | null;
  executionDurationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * Transactional outbox record: buffers events for asynchronous fanout.
 */
export interface OutboxRecord {
  id: string;
  eventId: string;
  status: OutboxStatus;
  attempts: number;
  claimedBy: string | null;
  claimedAt: Date | null;
  processedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Outbound webhook payload envelope delivered to target endpoints.
 */
export interface WebhookPayloadEnvelope<T = Record<string, unknown>> {
  id: string;
  event: string;
  source: string;
  timestamp: string;
  data: T;
}
