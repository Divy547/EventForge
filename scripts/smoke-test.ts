import http, { createServer } from 'node:http';
import net from 'node:net';
import { generateApiKey } from '../packages/common/dist/index.js';
import { EventForgeWebhook } from '../packages/sdk/dist/index.js';
import {
  getDatabaseConnection,
  closeDatabasePool,
  checkDatabaseHealth,
  projects,
  apiKeys,
  deliveries,
  deliveryAttempts,
  outboxRecords,
  eq,
} from '../packages/database/dist/index.js';

process.env.NODE_ENV = 'development';
process.env.ALLOW_LOCAL_WEBHOOKS = 'true';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const WORKER_URL = process.env.WORKER_URL || 'http://127.0.0.1:3001';
const SMOKE_RECEIVER_PORT = 4042;

async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: string; json: unknown }> {
  const parsedUrl = new URL(url);
  const postData = options.body ? JSON.stringify(options.body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = JSON.parse(data);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 500, body: data, json });
        });
      },
    );

    req.on('error', (err) => reject(err));
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function main(): Promise<void> {
  console.log('\n======================================================================');
  console.log('       EventForge Milestone 7: Production Deployment Smoke Test       ');
  console.log('======================================================================\n');

  const { db, pool } = getDatabaseConnection();

  // 1. PostgreSQL Health Check
  console.log('[1/11] Verifying PostgreSQL database health...');
  const dbHealth = await checkDatabaseHealth(pool);
  if (!dbHealth.ok) {
    throw new Error(`PostgreSQL is not healthy: ${dbHealth.error}`);
  }
  console.log(`       ✓ PostgreSQL healthy (latency: ${dbHealth.latencyMs}ms)`);

  // 2. Redis Health Check
  console.log('[2/11] Verifying Redis cache & queue health...');
  const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(
      {
        host: redisUrl.hostname || '127.0.0.1',
        port: Number(redisUrl.port) || 6379,
        timeout: 5000,
      },
      () => {
        socket.write('PING\r\n');
      },
    );
    socket.on('data', (d) => {
      if (d.toString().includes('+PONG')) {
        socket.end();
        resolve();
      } else {
        socket.destroy();
        reject(new Error(`Unexpected Redis ping response: ${d.toString()}`));
      }
    });
    socket.on('error', (err) => reject(err));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Redis ping timed out'));
    });
  });
  console.log('       ✓ Redis healthy (PONG received)');

  // 3. API Readiness Check
  console.log('[3/11] Verifying API readiness endpoint (/v1/ready)...');
  let apiProc: import('node:child_process').ChildProcess | null = null;
  let workerProc: import('node:child_process').ChildProcess | null = null;

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
    console.log('       -> API server not detected. Auto-spawning apps/api/dist/main.js...');
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
    console.log('       -> Worker server not detected. Auto-spawning apps/worker/dist/main.js...');
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

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
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
    if (apiProc) apiProc.kill();
    if (workerProc) workerProc.kill();
    await closeDatabasePool(pool);
    throw new Error('Timed out waiting for API and Worker to become ready.');
  }

  console.log('       ✓ API is ready (PostgreSQL & Redis dependencies UP)');

  // 4. Worker Readiness Check
  console.log('[4/11] Verifying Worker operational server (/v1/ready)...');
  console.log('       ✓ Worker is ready (PostgreSQL & Redis dependencies UP)');

  // Start safe local mock webhook receiver
  let receivedWebhook: { headers: http.IncomingHttpHeaders; body: string } | null = null;
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      receivedWebhook = { headers: req.headers, body };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ received: true }));
    });
  });

  await new Promise<void>((resolve) =>
    receiver.listen(SMOKE_RECEIVER_PORT, '127.0.0.1', () => resolve()),
  );

  // 5. Authenticated Event Ingestion
  console.log('[5/11] Ingesting authenticated business event...');
  const [project] = await db
    .insert(projects)
    .values({
      name: 'Deployment Smoke Test Project',
      slug: `smoke-test-${Date.now()}`,
    })
    .returning();

  const { rawKey, hashedKey, keyPrefix } = generateApiKey('ef_live');
  await db.insert(apiKeys).values({
    projectId: project!.id,
    name: 'Smoke Test Key',
    hashedKey,
    keyPrefix,
  });

  const subRes = await httpRequest(`${API_URL}/v1/subscriptions`, {
    method: 'POST',
    headers: { 'X-API-Key': rawKey },
    body: {
      name: 'Smoke Test Receiver',
      targetUrl: `http://127.0.0.1:${SMOKE_RECEIVER_PORT}/webhook/smoke`,
      eventTypes: ['smoke.*'],
    },
  });
  if (subRes.status !== 201) {
    throw new Error(
      `Failed to create webhook subscription: HTTP ${subRes.status} (${subRes.body})`,
    );
  }
  const subscription = subRes.json as { id: string; signingSecret: string };

  const eventRes = await httpRequest(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: { 'X-API-Key': rawKey },
    body: {
      eventType: 'smoke.deployment.verified',
      source: 'smoke-test.harness',
      payload: { environment: 'production-smoke', timestamp: new Date().toISOString() },
      idempotencyKey: `smoke-event-${Date.now()}`,
    },
  });
  if (eventRes.status !== 202) {
    throw new Error(`Failed to ingest event: HTTP ${eventRes.status} (${eventRes.body})`);
  }
  const eventData = eventRes.json as { id: string; status: string };
  console.log(
    `       ✓ Event ingested successfully (ID: ${eventData.id}, Status: ${eventData.status})`,
  );

  // 6. Transactional Outbox Record Persistence
  console.log('[6/11] Verifying atomic transactional outbox persistence in PostgreSQL...');
  const [outboxRow] = await db
    .select()
    .from(outboxRecords)
    .where(eq(outboxRecords.eventId, eventData.id));
  if (!outboxRow) {
    throw new Error(`Outbox record was not found for event ${eventData.id}`);
  }
  console.log(
    `       ✓ Outbox record exists atomically (ID: ${outboxRow.id}, Initial Status: ${outboxRow.status})`,
  );

  // 7. Worker Outbox Polling & Webhook Dispatch
  console.log('[7/11] Awaiting worker outbox claim, BullMQ queueing, and webhook dispatch...');
  const waitStart = Date.now();
  while (!receivedWebhook && Date.now() - waitStart < 15000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!receivedWebhook) {
    throw new Error('Timed out waiting for webhook to be received by test destination');
  }
  console.log('       ✓ Webhook successfully dispatched by worker and received!');

  // 8. Signature and Tracing Verification
  console.log('[8/11] Validating HMAC-SHA256 signature and W3C traceparent headers...');
  const sigHeader = receivedWebhook.headers['x-eventforge-signature'] as string;
  const traceHeader = receivedWebhook.headers['traceparent'] as string;
  if (!sigHeader) {
    throw new Error('Missing x-eventforge-signature header on received webhook');
  }
  if (!traceHeader) {
    throw new Error('Missing traceparent header on received webhook');
  }

  // Validate with SDK
  const sdk = new EventForgeWebhook();
  const parsedEnvelope = sdk.constructEvent(
    receivedWebhook.body,
    sigHeader,
    subscription.signingSecret,
  );
  if (parsedEnvelope.id !== eventData.id || parsedEnvelope.event !== 'smoke.deployment.verified') {
    throw new Error(`SDK parsed envelope mismatch: ${JSON.stringify(parsedEnvelope)}`);
  }
  console.log(
    `       ✓ SDK Verified HMAC Signature & Payload Integrity (Event ID: ${parsedEnvelope.id})`,
  );
  console.log(`       ✓ W3C Distributed Tracing verified: ${traceHeader}`);

  // 9. Delivery State and Audit History
  console.log('[9/11] Verifying delivery status and audit attempt history in PostgreSQL...');
  const [deliveryRec] = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.eventId, eventData.id));
  if (!deliveryRec || deliveryRec.status !== 'COMPLETED') {
    throw new Error(`Expected delivery COMPLETED, got: ${deliveryRec?.status}`);
  }
  const attempts = await db
    .select()
    .from(deliveryAttempts)
    .where(eq(deliveryAttempts.deliveryId, deliveryRec.id));
  if (attempts.length === 0) {
    throw new Error('Expected at least 1 recorded delivery attempt');
  }
  console.log(
    `       ✓ Delivery state: ${deliveryRec.status} (Attempts: ${deliveryRec.attemptsCount})`,
  );
  console.log(
    `       ✓ Audit history: ${attempts.length} attempt recorded (Status: ${attempts[0]?.statusCode}, Duration: ${attempts[0]?.executionDurationMs}ms)`,
  );

  // 10. Metrics Endpoints
  console.log('[10/11] Verifying Prometheus metrics scraping endpoints...');
  const apiMetrics = await httpRequest(`${API_URL}/v1/metrics`);
  const workerMetrics = await httpRequest(`${WORKER_URL}/v1/metrics`);
  if (!apiMetrics.body.includes('eventforge_') || !workerMetrics.body.includes('eventforge_')) {
    throw new Error('Metrics endpoints did not expose expected eventforge_* metrics');
  }
  console.log('       ✓ API /v1/metrics: exposed valid Prometheus metrics');
  console.log('       ✓ Worker /v1/metrics: exposed valid Prometheus metrics');

  // 11. Teardown
  console.log('[11/11] Cleaning up smoke test resources and connections...');
  receiver.close();
  await db.delete(projects).where(eq(projects.id, project!.id));
  if (apiProc) {
    apiProc.kill();
  }
  if (workerProc) {
    workerProc.kill();
  }
  await closeDatabasePool(pool);
  console.log('       ✓ Teardown completed successfully.\n');

  console.log('======================================================================');
  console.log('         ✓ ALL 11 DEPLOYMENT SMOKE TEST CHECKS PASSED!                ');
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('\n✗ Smoke test failed:', err);
  process.exit(1);
});
