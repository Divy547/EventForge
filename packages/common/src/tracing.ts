import { randomBytes } from 'node:crypto';
import { trace, type Tracer } from '@opentelemetry/api';

/**
 * W3C Trace Context constants.
 */
export const W3C_TRACEPARENT_HEADER = 'traceparent';
export const W3C_TRACESTATE_HEADER = 'tracestate';

const TRACE_ID_REGEX = /^[0-9a-f]{32}$/;
const SPAN_ID_REGEX = /^[0-9a-f]{16}$/;
const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ParsedTraceContext {
  version: string;
  traceId: string;
  spanId: string;
  traceFlags: string;
}

export interface TraceCarrier {
  traceparent?: string | undefined;
  tracestate?: string | undefined;
}

/**
 * Validates whether a string is a compliant 32-hex W3C trace ID (non-zero).
 */
export function isValidTraceId(id: string): boolean {
  return TRACE_ID_REGEX.test(id) && id !== '00000000000000000000000000000000';
}

/**
 * Validates whether a string is a compliant 16-hex W3C span ID (non-zero).
 */
export function isValidSpanId(id: string): boolean {
  return SPAN_ID_REGEX.test(id) && id !== '0000000000000000';
}

/**
 * Generates a random 32-hex character trace ID.
 */
export function generateTraceId(): string {
  let id = randomBytes(16).toString('hex');
  while (!isValidTraceId(id)) {
    id = randomBytes(16).toString('hex');
  }
  return id;
}

/**
 * Generates a random 16-hex character span ID.
 */
export function generateSpanId(): string {
  let id = randomBytes(8).toString('hex');
  while (!isValidSpanId(id)) {
    id = randomBytes(8).toString('hex');
  }
  return id;
}

/**
 * Parses and validates a W3C traceparent header string.
 * Returns null if the header is malformed, has invalid version, or contains all-zero IDs.
 */
export function parseTraceparent(header?: string | null): ParsedTraceContext | null {
  if (!header || typeof header !== 'string') {
    return null;
  }

  const trimmed = header.trim().toLowerCase();
  const match = TRACEPARENT_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const [, version, traceId, spanId, traceFlags] = match;

  // W3C spec: version 00 must be exactly 4 parts
  if (version === '00' && trimmed.length !== 55) {
    return null;
  }

  // W3C spec: version ff is invalid
  if (version === 'ff') {
    return null;
  }

  if (!isValidTraceId(traceId!) || !isValidSpanId(spanId!)) {
    return null;
  }

  return {
    version: version!,
    traceId: traceId!,
    spanId: spanId!,
    traceFlags: traceFlags!,
  };
}

/**
 * Formats a valid W3C traceparent string.
 */
export function formatTraceparent(traceId: string, spanId: string, traceFlags = '01'): string {
  return `00-${traceId}-${spanId}-${traceFlags}`;
}

/**
 * Creates a compliant child traceparent preserving the traceId and traceFlags,
 * while generating a fresh spanId. If input is invalid or absent, generates a new root traceparent.
 */
export function createChildTraceparent(parentTraceparent?: string | null): string {
  const parsed = parseTraceparent(parentTraceparent);
  if (!parsed) {
    return formatTraceparent(generateTraceId(), generateSpanId(), '01');
  }

  return formatTraceparent(parsed.traceId, generateSpanId(), parsed.traceFlags);
}

/**
 * Extracts and validates W3C trace context from request/carrier headers.
 */
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>,
): TraceCarrier {
  let rawTraceparent: string | undefined;
  let rawTracestate: string | undefined;

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === W3C_TRACEPARENT_HEADER) {
      rawTraceparent = Array.isArray(value) ? value[0] : value;
    } else if (lowerKey === W3C_TRACESTATE_HEADER) {
      rawTracestate = Array.isArray(value) ? value.join(',') : value;
    }
  }

  const parsed = parseTraceparent(rawTraceparent);
  if (!parsed) {
    return {};
  }

  return {
    traceparent: formatTraceparent(parsed.traceId, parsed.spanId, parsed.traceFlags),
    tracestate: rawTracestate?.trim() || undefined,
  };
}

/**
 * Injects W3C trace context into an outbound headers carrier.
 */
export function injectTraceContext(carrier: Record<string, string>, context?: TraceCarrier): void {
  if (!context?.traceparent) {
    return;
  }

  carrier[W3C_TRACEPARENT_HEADER] = context.traceparent;
  if (context.tracestate) {
    carrier[W3C_TRACESTATE_HEADER] = context.tracestate;
  }
}

/**
 * Returns the OpenTelemetry tracer instance for EventForge.
 */
export function getEventForgeTracer(): Tracer {
  return trace.getTracer('eventforge', '1.0.0');
}

/**
 * Sanitizes target URLs for telemetry attributes, removing query strings and credentials
 * to avoid leaking tokens or creating unbounded cardinality.
 */
export function sanitizeTelemetryUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid_url';
  }
}
