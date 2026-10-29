import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  HttpDispatcherService,
  WebhookDispatchError,
} from '../src/delivery/http-dispatcher.service.js';
import { WorkerConfigService } from '../src/config/worker-config.service.js';
import { verifyWebhookSignature } from '@eventforge/common';

describe('HttpDispatcherService', () => {
  let server: http.Server;
  let serverUrl: string;
  let receivedHeaders: http.IncomingHttpHeaders = {};
  let receivedBody = '';
  let responseStatusCode = 200;
  const responseHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  let responseBody = JSON.stringify({ ok: true });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      receivedBody = '';
      req.on('data', (chunk) => {
        receivedBody += chunk;
      });
      req.on('end', () => {
        for (const [key, value] of Object.entries(responseHeaders)) {
          res.setHeader(key, value);
        }
        res.statusCode = responseStatusCode;
        res.end(responseBody);
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const createDispatcher = (allowLocal: boolean, timeoutMs = 2000) => {
    const mockConfig = {
      allowLocalWebhooks: allowLocal,
      webhookTimeoutMs: timeoutMs,
    } as unknown as WorkerConfigService;

    return new HttpDispatcherService(mockConfig);
  };

  it('delivers signed payload with required headers', async () => {
    const dispatcher = createDispatcher(true);
    responseStatusCode = 200;
    responseBody = JSON.stringify({ received: true });

    const signingSecret = 'whsec_test_secret_12345';
    const payload = JSON.stringify({ id: 'evt-1', event: 'order.created' });

    const result = await dispatcher.dispatch({
      targetUrl: `${serverUrl}/webhook`,
      payloadString: payload,
      signingSecret,
      deliveryId: 'del-123',
      eventId: 'evt-1',
      customHeaders: { 'X-Custom-Header': 'custom-val' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.bodySnippet).toBe(responseBody);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify incoming headers received by mock server
    expect(receivedHeaders['x-eventforge-delivery-id']).toBe('del-123');
    expect(receivedHeaders['x-eventforge-event-id']).toBe('evt-1');
    expect(receivedHeaders['x-custom-header']).toBe('custom-val');
    expect(receivedHeaders['content-type']).toBe('application/json');

    const sigHeader = receivedHeaders['x-eventforge-signature'] as string;
    expect(sigHeader).toBeDefined();

    const isValidSig = verifyWebhookSignature(signingSecret, receivedBody, sigHeader);
    expect(isValidSig).toBe(true);
  });

  it('blocks SSRF destinations when local webhooks are prohibited', async () => {
    const dispatcher = createDispatcher(false);

    await expect(
      dispatcher.dispatch({
        targetUrl: 'http://127.0.0.1:8080/webhook',
        payloadString: '{}',
        signingSecret: 'sec',
        deliveryId: 'del-1',
        eventId: 'evt-1',
      }),
    ).rejects.toThrow(WebhookDispatchError);

    await expect(
      dispatcher.dispatch({
        targetUrl: 'http://169.254.169.254/latest/meta-data',
        payloadString: '{}',
        signingSecret: 'sec',
        deliveryId: 'del-2',
        eventId: 'evt-2',
      }),
    ).rejects.toThrow(WebhookDispatchError);
  });

  it('handles 4xx client errors by throwing WebhookDispatchError with status and snippet', async () => {
    const dispatcher = createDispatcher(true);
    responseStatusCode = 404;
    responseBody = JSON.stringify({ error: 'Endpoint Not Found' });

    await expect(
      dispatcher.dispatch({
        targetUrl: `${serverUrl}/not-found`,
        payloadString: '{}',
        signingSecret: 'sec',
        deliveryId: 'del-1',
        eventId: 'evt-1',
      }),
    ).rejects.toMatchObject({
      errorCode: 'HTTP_CLIENT_ERROR',
      statusCode: 404,
      bodySnippet: JSON.stringify({ error: 'Endpoint Not Found' }),
    });
  });

  it('handles 5xx server errors by throwing WebhookDispatchError with status', async () => {
    const dispatcher = createDispatcher(true);
    responseStatusCode = 503;
    responseBody = JSON.stringify({ error: 'Service Unavailable' });

    await expect(
      dispatcher.dispatch({
        targetUrl: `${serverUrl}/server-error`,
        payloadString: '{}',
        signingSecret: 'sec',
        deliveryId: 'del-1',
        eventId: 'evt-1',
      }),
    ).rejects.toMatchObject({
      errorCode: 'HTTP_SERVER_ERROR',
      statusCode: 503,
    });
  });

  it('times out when target endpoint takes too long to respond', async () => {
    const hangingServer = http.createServer((_req, _res) => {
      // Never respond
    });

    await new Promise<void>((resolve) => {
      hangingServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = hangingServer.address() as AddressInfo;
    const hangingUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const dispatcher = createDispatcher(true, 100); // 100ms timeout
      await expect(
        dispatcher.dispatch({
          targetUrl: `${hangingUrl}/hang`,
          payloadString: '{}',
          signingSecret: 'sec',
          deliveryId: 'del-hang',
          eventId: 'evt-hang',
        }),
      ).rejects.toMatchObject({
        errorCode: 'TIMEOUT',
      });
    } finally {
      await new Promise<void>((resolve) => {
        hangingServer.close(() => resolve());
      });
    }
  });
});
