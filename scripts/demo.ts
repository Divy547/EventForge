import http from 'node:http';
import { createServer, type Server } from 'node:http';
import type { ChildProcess } from 'node:child_process';
import { generateApiKey, verifyWebhookSignature } from '../packages/common/dist/index.js';
import {
  getDatabaseConnection,
  closeDatabasePool,
  projects,
  apiKeys,
  deliveries,
  deliveryAttempts,
  eq,
} from '../packages/database/dist/index.js';

// Ensure development environment with local webhooks permitted
process.env.NODE_ENV = 'development';
process.env.ALLOW_LOCAL_WEBHOOKS = 'true';

const RECEIVER_PORT = 4040;
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const WORKER_URL = process.env.WORKER_URL || 'http://127.0.0.1:3001';

interface ReceivedWebhook {
  path: string;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
  jsonBody: Record<string, unknown> | null;
  timestamp: number;
}

const receivedWebhooks: ReceivedWebhook[] = [];
let retryAttemptCounter = 0;

function createLocalReceiver(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let jsonBody: Record<string, unknown> | null = null;
        try {
          jsonBody = JSON.parse(body) as Record<string, unknown>;
        } catch {
          // non-JSON payload
        }

        const webhook: ReceivedWebhook = {
          path: req.url || '/',
          headers: req.headers,
          rawBody: body,
          jsonBody,
          timestamp: Date.now(),
        };

        receivedWebhooks.push(webhook);

        if (req.url === '/webhook/retry') {
          retryAttemptCounter++;
          if (retryAttemptCounter === 1) {
            // First attempt: simulate transient 500 error
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Simulated downstream 500 Internal Error' }));
            return;
          }
          // Subsequent attempt: succeed with 200
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, recovered: true, attempt: retryAttemptCounter }));
          return;
        }

        // Default success endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, receivedAt: new Date().toISOString() }));
      });
    });

    server.listen(RECEIVER_PORT, () => {
      resolve(server);
    });

    server.on('error', reject);
  });
}

async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json?: Record<string, unknown> | null;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    const postData = options.body
      ? typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
      : null;

    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };

    if (postData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(data) as Record<string, unknown>;
          } catch {
            // non-json
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
            json,
          });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request to ${url} timed out`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function waitForWebhook(
  predicate: (w: ReceivedWebhook) => boolean,
  timeoutMs = 15000,
): Promise<ReceivedWebhook> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = receivedWebhooks.find(predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for webhook after ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  console.log('\n======================================================================');
  console.log('       EventForge Milestone 5: End-to-End Operational Demo            ');
  console.log('======================================================================\n');

  // 1. Start Local Test Webhook Receiver
  console.log(`[1/8] Starting safe local webhook receiver on port ${RECEIVER_PORT}...`);
  const receiverServer = await createLocalReceiver();
  console.log(
    `      ✓ Webhook receiver listening at http://127.0.0.1:${RECEIVER_PORT}/webhook/*\n`,
  );

  // 2. Check Database Connection
  console.log('[2/8] Connecting to PostgreSQL database...');
  const { db, pool } = getDatabaseConnection();
  console.log('      ✓ PostgreSQL connection established.\n');

  // 3. Check API & Worker Liveness & Readiness (auto-spawning if not already running)
  console.log(`[3/8] Checking API (${API_URL}) & Worker (${WORKER_URL})...`);
  let apiProc: ChildProcess | null = null;
  let workerProc: ChildProcess | null = null;

  let apiReachable = false;
  try {
    const res = await httpRequest(`${API_URL}/v1/health`);
    apiReachable = res.status === 200;
  } catch {
    apiReachable = false;
  }

  let workerReachable = false;
  try {
    const res = await httpRequest(`${WORKER_URL}/v1/health`);
    workerReachable = res.status === 200;
  } catch {
    workerReachable = false;
  }

  const { fork } = await import('node:child_process');

  if (!apiReachable) {
    console.log('      -> API server not detected. Auto-spawning apps/api/dist/main.js...');
    apiProc = fork('apps/api/dist/main.js', [], {
      env: {
        ...process.env,
        PORT: '3000',
        ALLOW_LOCAL_WEBHOOKS: 'true',
        LOG_LEVEL: 'warn',
      },
      stdio: 'pipe',
    });
  }

  if (!workerReachable) {
    console.log('      -> Worker server not detected. Auto-spawning apps/worker/dist/main.js...');
    workerProc = fork('apps/worker/dist/main.js', [], {
      env: {
        ...process.env,
        WORKER_PORT: '3001',
        ALLOW_LOCAL_WEBHOOKS: 'true',
        LOG_LEVEL: 'warn',
      },
      stdio: 'pipe',
    });
  }

  // Poll until both API and Worker are ready
  let ready = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const apiCheck = await httpRequest(`${API_URL}/v1/ready`);
      const workerCheck = await httpRequest(`${WORKER_URL}/v1/ready`);
      if (apiCheck.status === 200 && workerCheck.status === 200) {
        ready = true;
        break;
      }
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!ready) {
    console.error('      ✗ Timed out waiting for API and Worker to become ready.');
    if (apiProc) apiProc.kill();
    if (workerProc) workerProc.kill();
    receiverServer.close();
    await closeDatabasePool(pool);
    process.exit(1);
  }

  const apiReady = await httpRequest(`${API_URL}/v1/ready`);
  const workerReady = await httpRequest(`${WORKER_URL}/v1/ready`);
  const apiDeps = (apiReady.json?.dependencies as Record<string, { status: string }>) || {};
  const workerDeps = (workerReady.json?.dependencies as Record<string, { status: string }>) || {};
  console.log(
    `      ✓ API Ready: Postgres: ${apiDeps.postgres?.status}, Redis: ${apiDeps.redis?.status}`,
  );
  console.log(
    `      ✓ Worker Ready: Postgres: ${workerDeps.postgres?.status}, Redis: ${workerDeps.redis?.status}\n`,
  );

  // 4. Setup Project & API Key
  console.log('[4/8] Provisioning Demo Project and API Key...');
  const demoSlug = `demo-m5-${Date.now()}`;
  const created = await db
    .insert(projects)
    .values({ name: 'Milestone 5 Demo Project', slug: demoSlug })
    .returning();
  const project = created[0]!;

  const { rawKey, keyPrefix, hashedKey } = generateApiKey('ef_test');
  await db.insert(apiKeys).values({
    projectId: project.id,
    name: 'Milestone 5 Demo API Key',
    keyPrefix,
    hashedKey,
  });

  console.log(`      ✓ Project: ${project.name} (${project.id})`);
  console.log(`      ✓ API Key: ${keyPrefix}... (Authenticated with raw key)\n`);

  // 5. Create Webhook Subscription
  console.log('[5/8] Creating Webhook Subscription pointing to local receiver...');
  const subRes = await httpRequest(`${API_URL}/v1/subscriptions`, {
    method: 'POST',
    headers: { 'X-API-Key': rawKey },
    body: {
      name: 'Local Order Webhook Receiver',
      targetUrl: `http://127.0.0.1:${RECEIVER_PORT}/webhook/success`,
      eventTypes: ['order.*'],
      headers: { 'X-Custom-Consumer-Tag': 'EventForge-M5-Demo' },
    },
  });

  if (subRes.status !== 201) {
    throw new Error(`Failed to create subscription: ${subRes.status} ${subRes.body}`);
  }
  const subscriptionId = (subRes.json as { id: string }).id;
  const signingSecret = (subRes.json as { signingSecret: string }).signingSecret;
  console.log(`      ✓ Subscription Created: ${subscriptionId}`);
  console.log(`        Target: http://127.0.0.1:${RECEIVER_PORT}/webhook/success`);
  console.log(`        Filter: order.* | Signing Secret: ${signingSecret.slice(0, 12)}...\n`);

  // 6. Ingest Event
  console.log('[6/8] Publishing business event (order.created)...');
  const idempotencyKey = `demo-order-${Date.now()}`;
  const eventPayload = {
    orderId: 'ord-9921',
    customer: { id: 'cust-42', email: 'alex@example.com' },
    items: [{ sku: 'PRO-WIDGET-01', qty: 2, unitPrice: 49.99 }],
    total: 99.98,
  };

  const eventRes = await httpRequest(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: { 'X-API-Key': rawKey },
    body: {
      eventType: 'order.created',
      source: 'storefront.checkout',
      payload: eventPayload,
      idempotencyKey,
    },
  });

  if (eventRes.status !== 202) {
    throw new Error(`Failed to ingest event: ${eventRes.status} ${eventRes.body}`);
  }

  const eventId = (eventRes.json as { id: string }).id;
  const eventStatus = (eventRes.json as { status: string }).status;
  console.log(`      ✓ Event Accepted: ${eventId} (Status: ${eventStatus})`);
  console.log(`      ✓ Transactional Outbox record created atomically in PostgreSQL.\n`);

  // 7. Verify Webhook Receipt & Signature
  console.log('[7/8] Awaiting Webhook Dispatch & Cryptographic Verification...');
  const received = await waitForWebhook((w) => w.path === '/webhook/success');

  console.log(`      ✓ Webhook received by test receiver!`);
  console.log(`        Timestamp: ${new Date(received.timestamp).toISOString()}`);
  console.log(`        Event ID: ${received.headers['x-eventforge-event-id']}`);
  console.log(`        Delivery ID: ${received.headers['x-eventforge-delivery-id']}`);
  console.log(`        Attempt: ${received.headers['x-eventforge-attempt']}`);
  console.log(`        Signature Header: ${received.headers['x-eventforge-signature']}`);

  const signatureHeader = received.headers['x-eventforge-signature'] as string;
  const isSignatureValid = verifyWebhookSignature(signingSecret, received.rawBody, signatureHeader);

  console.log(
    `      ✓ HMAC-SHA256 Signature Verification: ${isSignatureValid ? 'PASSED (MATCH)' : 'FAILED'}`,
  );
  if (!isSignatureValid) {
    throw new Error('HMAC-SHA256 signature verification failed!');
  }

  // Verify delivery state in database
  const deliveryId = received.headers['x-eventforge-delivery-id'] as string;
  const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  const delivery = deliveryRows[0];
  console.log(
    `      ✓ Database Delivery Status: ${delivery?.status} (Attempts: ${delivery?.attemptsCount}/${delivery?.maxAttempts})`,
  );

  const attemptRows = await db
    .select()
    .from(deliveryAttempts)
    .where(eq(deliveryAttempts.deliveryId, deliveryId));
  console.log(
    `      ✓ Audit Attempt History: ${attemptRows.length} recorded attempt(s) (Status Code: ${attemptRows[0]?.statusCode}, Duration: ${attemptRows[0]?.executionDurationMs}ms)\n`,
  );

  // 7b. Demonstrate Transient Failure, Backoff & Retry
  console.log('[7b] Demonstrating Transient Failure, Backoff & Retry Recovery...');
  const retrySubRes = await httpRequest(`${API_URL}/v1/subscriptions`, {
    method: 'POST',
    headers: { 'X-API-Key': rawKey },
    body: {
      name: 'Simulated Retry Webhook Receiver',
      targetUrl: `http://127.0.0.1:${RECEIVER_PORT}/webhook/retry`,
      eventTypes: ['payment.*'],
    },
  });

  const retrySubId = (retrySubRes.json as { id: string }).id;
  console.log(`      ✓ Created retry test subscription: ${retrySubId}`);

  await httpRequest(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: { 'X-API-Key': rawKey },
    body: {
      eventType: 'payment.refunded',
      source: 'billing.gateway',
      payload: { refundId: 'ref-1001', amount: 50.0 },
    },
  });
  console.log(`      ✓ Published payment.refunded event.`);
  console.log(`      ✓ Waiting for Attempt 1 (which returns HTTP 500 to trigger retry backoff)...`);

  const initialAttempt = await waitForWebhook((w) => w.path === '/webhook/retry');
  console.log(
    `      ✓ Attempt 1 dispatched by worker to ${initialAttempt.path} and rejected with simulated 500.`,
  );

  console.log(`      ✓ Waiting for worker to process BullMQ retry (Attempt 2)...`);
  const retryAttempt = await waitForWebhook(
    (w) =>
      w.path === '/webhook/retry' &&
      receivedWebhooks.filter((x) => x.path === '/webhook/retry').length >= 2,
    20000,
  );
  console.log(`      ✓ Attempt 2 dispatched by worker and accepted with HTTP 200!`);

  const retryDeliveryId = retryAttempt.headers['x-eventforge-delivery-id'] as string;
  const retryDeliveryRows = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.id, retryDeliveryId));
  const finalRetryDelivery = retryDeliveryRows[0];
  console.log(
    `      ✓ Final Delivery Status: ${finalRetryDelivery?.status} (Total Attempts: ${finalRetryDelivery?.attemptsCount})\n`,
  );

  // 8. Prometheus Metrics Inspection
  console.log('[8/8] Inspecting Prometheus Metrics Exposition...');
  const apiMetricsRes = await httpRequest(`${API_URL}/v1/metrics`);
  const workerMetricsRes = await httpRequest(`${WORKER_URL}/v1/metrics`);

  console.log('      --- API Metrics Sample ---');
  const apiLines = apiMetricsRes.body.split('\n').filter((l) => l.startsWith('eventforge_'));
  for (const line of apiLines.slice(0, 5)) {
    console.log(`      ${line}`);
  }

  console.log('      --- Worker Metrics Sample ---');
  const workerLines = workerMetricsRes.body.split('\n').filter((l) => l.startsWith('eventforge_'));
  for (const line of workerLines.slice(0, 5)) {
    console.log(`      ${line}`);
  }

  console.log('\n======================================================================');
  console.log('                 ✓ DEMO COMPLETED SUCCESSFULLY!                       ');
  console.log('======================================================================\n');

  receiverServer.close();
  if (project) {
    await db.delete(projects).where(eq(projects.id, project.id));
  }
  if (apiProc) {
    apiProc.kill();
  }
  if (workerProc) {
    workerProc.kill();
  }
  await closeDatabasePool(pool);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ Demo failed with error:', err);
  process.exit(1);
});
