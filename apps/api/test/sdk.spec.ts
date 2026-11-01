import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  EventForgeWebhook,
  verifySignature,
  WebhookVerificationError,
  MemoryIdempotencyStore,
  EVENTFORGE_HEADERS,
} from '@eventforge/sdk';
import { signWebhookPayload } from '@eventforge/common';

describe('EventForge Consumer SDK (@eventforge/sdk)', () => {
  const secret = 'whsec_test_secret_abc123';
  const payload = JSON.stringify({
    id: '123e4567-e89b-12d3-a456-426614174000',
    event: 'order.completed',
    source: 'billing-service',
    timestamp: new Date().toISOString(),
    data: { orderId: 'ord_999', amount: 4999 },
  });

  let webhook: EventForgeWebhook;

  beforeEach(() => {
    webhook = new EventForgeWebhook({ toleranceSeconds: 300 });
  });

  describe('verifySignature', () => {
    it('verifies valid HMAC-SHA256 signature and fresh timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const signatureHeader = signWebhookPayload(secret, payload, now);

      const isValid = verifySignature(payload, signatureHeader, secret);
      expect(isValid).toBe(true);
    });

    it('throws MISSING_SIGNATURE when header or secret is missing', () => {
      expect(() => verifySignature(payload, '', secret)).toThrow(WebhookVerificationError);
      expect(() => verifySignature(payload, 't=123,v1=abc', '')).toThrow(WebhookVerificationError);
    });

    it('throws INVALID_FORMAT when signature header is malformed', () => {
      expect(() => verifySignature(payload, 'invalid-header-content', secret)).toThrow(
        WebhookVerificationError,
      );
      try {
        verifySignature(payload, 'invalid-header-content', secret);
      } catch (err) {
        expect((err as WebhookVerificationError).code).toBe('INVALID_FORMAT');
      }
    });

    it('throws TIMESTAMP_OUT_OF_RANGE when timestamp exceeds tolerance window', () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 305; // 5m 5s ago
      const signatureHeader = signWebhookPayload(secret, payload, expiredTimestamp);

      expect(() =>
        verifySignature(payload, signatureHeader, secret, { toleranceSeconds: 300 }),
      ).toThrow(WebhookVerificationError);

      try {
        verifySignature(payload, signatureHeader, secret, { toleranceSeconds: 300 });
      } catch (err) {
        expect((err as WebhookVerificationError).code).toBe('TIMESTAMP_OUT_OF_RANGE');
      }
    });

    it('throws SIGNATURE_MISMATCH when payload has been tampered with', () => {
      const now = Math.floor(Date.now() / 1000);
      const signatureHeader = signWebhookPayload(secret, payload, now);
      const tamperedPayload = payload.replace('4999', '9999');

      expect(() => verifySignature(tamperedPayload, signatureHeader, secret)).toThrow(
        WebhookVerificationError,
      );

      try {
        verifySignature(tamperedPayload, signatureHeader, secret);
      } catch (err) {
        expect((err as WebhookVerificationError).code).toBe('SIGNATURE_MISMATCH');
      }
    });

    it('throws SIGNATURE_MISMATCH when signed with a different secret', () => {
      const now = Math.floor(Date.now() / 1000);
      const signatureHeader = signWebhookPayload('whsec_different_secret', payload, now);

      expect(() => verifySignature(payload, signatureHeader, secret)).toThrow(
        WebhookVerificationError,
      );
    });
  });

  describe('EventForgeWebhook.constructEvent', () => {
    it('constructs typed envelope from verified signature and payload', () => {
      const now = Math.floor(Date.now() / 1000);
      const signatureHeader = signWebhookPayload(secret, payload, now);

      const event = webhook.constructEvent<{ orderId: string; amount: number }>(
        payload,
        signatureHeader,
        secret,
      );

      expect(event.id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(event.event).toBe('order.completed');
      expect(event.data.orderId).toBe('ord_999');
      expect(event.data.amount).toBe(4999);
    });

    it('extracts signature header from request headers object case-insensitively', () => {
      const now = Math.floor(Date.now() / 1000);
      const signatureHeader = signWebhookPayload(secret, payload, now);

      const headers = {
        'content-type': 'application/json',
        [EVENTFORGE_HEADERS.SIGNATURE]: signatureHeader,
      };

      const event = webhook.constructEvent(payload, headers, secret);
      expect(event.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('throws INVALID_PAYLOAD when payload JSON is invalid', () => {
      const now = Math.floor(Date.now() / 1000);
      const badPayload = '{ not-valid-json ';
      const signatureHeader = signWebhookPayload(secret, badPayload, now);

      expect(() => webhook.constructEvent(badPayload, signatureHeader, secret)).toThrow(
        WebhookVerificationError,
      );
      try {
        webhook.constructEvent(badPayload, signatureHeader, secret);
      } catch (err) {
        expect((err as WebhookVerificationError).code).toBe('INVALID_PAYLOAD');
      }
    });
  });

  describe('MemoryIdempotencyStore', () => {
    it('tracks processed events and prevents duplicate processing', () => {
      const store = new MemoryIdempotencyStore({ ttlSeconds: 60 });
      const eventId = 'evt_test_123';

      expect(store.has(eventId)).toBe(false);

      store.set(eventId);
      expect(store.has(eventId)).toBe(true);
    });

    it('evicts expired entries after TTL', async () => {
      const store = new MemoryIdempotencyStore({ ttlSeconds: 0.05 }); // 50ms TTL
      const eventId = 'evt_expires_soon';

      store.set(eventId, 0.05);
      expect(store.has(eventId)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(store.has(eventId)).toBe(false);
    });
  });
});
