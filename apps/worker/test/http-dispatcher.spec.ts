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

  const createDispatcher = (allowLocal: boolean, timeoutMs = 2000, sandboxReceiverUrl?: string) => {
    const mockConfig = {
      allowLocalWebhooks: allowLocal,
      webhookTimeoutMs: timeoutMs,
      sandboxReceiverUrl,
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

  describe('sandbox receiver exemption', () => {
    const dispatch = (dispatcher: HttpDispatcherService, targetUrl: string) =>
      dispatcher.dispatch({
        targetUrl,
        payloadString: '{}',
        signingSecret: 'sec',
        deliveryId: 'del-sb',
        eventId: 'evt-sb',
      });

    it('reaches the private receiver address, by IP and by host name, when local webhooks are off', async () => {
      const port = new URL(serverUrl).port;
      responseStatusCode = 200;
      for (const host of ['127.0.0.1', 'localhost']) {
        const base = `http://${host}:${port}/sandbox/receiver`;
        const dispatcher = createDispatcher(false, 2000, base);
        const result = await dispatch(dispatcher, `${base}/succeed`);
        expect(result.statusCode).toBe(200);
      }
    });

    it('still blocks every other private target', async () => {
      const port = new URL(serverUrl).port;
      const base = `http://127.0.0.1:${port}/sandbox/receiver`;
      const dispatcher = createDispatcher(false, 2000, base);
      const blocked = [
        `http://127.0.0.1:${port}/other`, // same host, outside the receiver path
        `http://127.0.0.1:${port}/sandbox/receiver/unknown`,
        `http://127.0.0.1:${port}/sandbox/receiver/succeed?x=1`,
        `http://127.0.0.1:${Number(port) + 1}/sandbox/receiver/succeed`, // another port
        `http://127.0.0.1:${port}/sandbox/receiver/../../v1/events`,
        'http://169.254.169.254/latest/meta-data',
      ];
      for (const url of blocked) {
        await expect(dispatch(dispatcher, url)).rejects.toMatchObject({
          errorCode: expect.stringMatching(/SSRF_BLOCKED|ECONNREFUSED/),
        });
      }
      // Nothing above may have reached the mock server on the wrong path.
      await expect(dispatch(dispatcher, `http://127.0.0.1:${port}/other`)).rejects.toMatchObject({
        errorCode: 'SSRF_BLOCKED',
      });
    });

    it('has no effect when no receiver is configured', async () => {
      const port = new URL(serverUrl).port;
      const dispatcher = createDispatcher(false, 2000, undefined);
      await expect(
        dispatch(dispatcher, `http://127.0.0.1:${port}/sandbox/receiver/succeed`),
      ).rejects.toMatchObject({ errorCode: 'SSRF_BLOCKED' });
    });
  });

  it('blocks a host name that resolves to a loopback address', async () => {
    // `localhost` is not blocked by name when local webhooks are off, so this proves the DNS
    // lookup hook itself refuses the loopback address it resolves to.
    const dispatcher = createDispatcher(false);
    const port = new URL(serverUrl).port;
    await expect(
      dispatcher.dispatch({
        targetUrl: `http://localhost.:${port}/hook`,
        payloadString: '{}',
        signingSecret: 'sec',
        deliveryId: 'del-dns',
        eventId: 'evt-dns',
      }),
    ).rejects.toMatchObject({ errorCode: 'SSRF_BLOCKED' });
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
