/**
 * EventForge delivery payload envelope format received by webhook endpoints.
 */
export interface EventForgeEnvelope<T = Record<string, unknown>> {
  id: string;
  event: string;
  source: string;
  timestamp: string;
  data: T;
}

export const EVENTFORGE_HEADERS = {
  SIGNATURE: 'x-eventforge-signature',
  TIMESTAMP: 'x-eventforge-timestamp',
  DELIVERY_ID: 'x-eventforge-delivery-id',
  EVENT_ID: 'x-eventforge-event-id',
  TRACEPARENT: 'traceparent',
  TRACESTATE: 'tracestate',
} as const;
