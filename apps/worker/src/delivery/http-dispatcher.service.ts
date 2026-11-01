import { Injectable } from '@nestjs/common';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { Socket } from 'node:net';
import {
  signWebhookPayload,
  truncateAndRedact,
  isPrivateIp,
  CLOUD_METADATA_HOSTS,
} from '@eventforge/common';
import { WorkerConfigService } from '../config/worker-config.service.js';

export interface DispatchWebhookInput {
  targetUrl: string;
  payloadString: string;
  signingSecret: string;
  deliveryId: string;
  eventId: string;
  customHeaders?: Record<string, string> | null;
  timeoutMs?: number;
  traceparent?: string | undefined;
  tracestate?: string | undefined;
}

export interface DispatchWebhookResult {
  statusCode: number;
  headers: Record<string, string>;
  bodySnippet: string | null;
  durationMs: number;
}

export class WebhookDispatchError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly statusCode: number | null,
    public readonly durationMs: number,
    public readonly headers: Record<string, string> | null = null,
    public readonly bodySnippet: string | null = null,
  ) {
    super(message);
    this.name = 'WebhookDispatchError';
  }
}

@Injectable()
export class HttpDispatcherService {
  constructor(private readonly configService: WorkerConfigService) {}

  /**
   * Dispatches an HTTP POST webhook request with HMAC signature, bounded response logging,
   * SSRF and DNS-rebinding protection, and timeout enforcement.
   */
  async dispatch(input: DispatchWebhookInput): Promise<DispatchWebhookResult> {
    const startTime = Date.now();
    const allowLocal = this.configService.allowLocalWebhooks;
    const timeoutMs = input.timeoutMs ?? this.configService.webhookTimeoutMs;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.targetUrl);
    } catch {
      throw new WebhookDispatchError('Invalid webhook target URL', 'INVALID_URL', null, 0);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new WebhookDispatchError(
        `Unsupported protocol '${parsedUrl.protocol}'`,
        'UNSUPPORTED_PROTOCOL',
        null,
        0,
      );
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (CLOUD_METADATA_HOSTS.has(hostname) || hostname.endsWith('.internal')) {
      throw new WebhookDispatchError(
        'Target hostname is blacklisted (cloud metadata)',
        'SSRF_BLOCKED',
        null,
        0,
      );
    }

    if (!allowLocal && (hostname === 'localhost' || hostname === '0.0.0.0')) {
      throw new WebhookDispatchError(
        'Target hostname resolves to localhost/loopback',
        'SSRF_BLOCKED',
        null,
        0,
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(input.signingSecret, input.payloadString, timestamp);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(input.payloadString).toString(),
      'User-Agent': 'EventForge-Webhook/1.0',
      'X-EventForge-Delivery-Id': input.deliveryId,
      'X-EventForge-Event-Id': input.eventId,
      'X-EventForge-Signature': signature,
      'X-EventForge-Timestamp': timestamp.toString(),
    };

    if (input.traceparent) {
      headers['traceparent'] = input.traceparent;
    }
    if (input.tracestate) {
      headers['tracestate'] = input.tracestate;
    }

    if (input.customHeaders) {
      for (const [key, value] of Object.entries(input.customHeaders)) {
        if (
          !key.toLowerCase().startsWith('x-eventforge-') &&
          key.toLowerCase() !== 'content-length'
        ) {
          headers[key] = value;
        }
      }
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error('Webhook request timed out'));
    }, timeoutMs);

    const transport = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise<DispatchWebhookResult>((resolve, reject) => {
      let isSettled = false;

      const safeReject = (error: WebhookDispatchError) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutHandle);
        reject(error);
      };

      const safeResolve = (result: DispatchWebhookResult) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutHandle);
        resolve(result);
      };

      const customLookup = (
        host: string,
        opts: dns.LookupOptions,
        callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
      ) => {
        dns.lookup(host, opts, (err, address, family) => {
          if (err) {
            return callback(err, address as string, family);
          }
          if (!allowLocal && isPrivateIp(address as string)) {
            return callback(
              new Error(`SSRF blocked: IP address ${address} is private or restricted`),
              '',
              family,
            );
          }
          callback(null, address as string, family);
        });
      };

      const requestOptions: http.RequestOptions = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers,
        signal: abortController.signal,
        lookup: customLookup,
      };

      const req = transport.request(requestOptions, (res) => {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode ?? 0;

        const responseHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (val !== undefined) {
            responseHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
          }
        }

        let bodyBuffer = '';
        res.setEncoding('utf8');

        res.on('data', (chunk: string) => {
          if (bodyBuffer.length < 4096) {
            bodyBuffer += chunk;
          }
        });

        res.on('end', () => {
          const bodySnippet = truncateAndRedact(bodyBuffer, 4096);

          if (statusCode >= 200 && statusCode < 300) {
            safeResolve({
              statusCode,
              headers: responseHeaders,
              bodySnippet,
              durationMs,
            });
          } else {
            safeReject(
              new WebhookDispatchError(
                `Endpoint returned non-2xx status code: ${statusCode}`,
                statusCode >= 500 ? 'HTTP_SERVER_ERROR' : 'HTTP_CLIENT_ERROR',
                statusCode,
                durationMs,
                responseHeaders,
                bodySnippet,
              ),
            );
          }
        });
      });

      // Socket inspection: validates remote IP immediately upon TCP connect before sending data
      req.on('socket', (socket: Socket) => {
        const verifySocketAddress = () => {
          const remoteAddress = socket.remoteAddress;
          if (remoteAddress && !allowLocal && isPrivateIp(remoteAddress)) {
            const ssrfErr = new Error(
              `SSRF blocked: Dialed socket remote address ${remoteAddress} is restricted`,
            );
            socket.destroy(ssrfErr);
          }
        };

        if (socket.connecting) {
          socket.once('connect', verifySocketAddress);
        } else {
          verifySocketAddress();
        }
      });

      req.on('error', (err: Error & { code?: string }) => {
        const durationMs = Date.now() - startTime;
        const isTimeout =
          abortController.signal.aborted || err.name === 'AbortError' || err.code === 'ETIMEDOUT';

        const isSsrf =
          err.message.includes('SSRF blocked') || err.message.includes('private or restricted');

        const errorCode = isTimeout
          ? 'TIMEOUT'
          : isSsrf
            ? 'SSRF_BLOCKED'
            : err.code || 'NETWORK_ERROR';

        safeReject(new WebhookDispatchError(err.message, errorCode, null, durationMs));
      });

      try {
        req.write(input.payloadString);
        req.end();
      } catch (err) {
        const durationMs = Date.now() - startTime;
        safeReject(
          new WebhookDispatchError(
            err instanceof Error ? err.message : String(err),
            'REQUEST_WRITE_ERROR',
            null,
            durationMs,
          ),
        );
      }
    });
  }
}
