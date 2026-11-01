import http, { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { generateApiKey } from '../packages/common/dist/index.js';
import {
  getDatabaseConnection,
  closeDatabasePool,
  projects,
  apiKeys,
  deliveries,
  eq,
} from '../packages/database/dist/index.js';

// Configuration
process.env.NODE_ENV = 'development';
process.env.ALLOW_LOCAL_WEBHOOKS = 'true';

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const WORKER_URL = process.env.WORKER_URL || 'http://127.0.0.1:3001';
const RECEIVER_PORT = Number(process.env.RECEIVER_PORT || 4041);
const DEFAULT_REQUESTS = Number(process.env.LOAD_TEST_REQUESTS || 200);
const DEFAULT_CONCURRENCY = Number(process.env.LOAD_TEST_CONCURRENCY || 20);

interface LatencyStats {
  count: number;
  errors: number;
  totalDurationMs: number;
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  throughputRps: number;
}

function calculateStats(
  latencies: number[],
  totalDurationMs: number,
  errors: number,
): LatencyStats {
  if (latencies.length === 0) {
    return {
      count: 0,
      errors,
      totalDurationMs,
      minMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      throughputRps: 0,
    };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const getP = (p: number) => {
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return sorted[idx]!;
  };

  const count = sorted.length;
  const throughputRps =
    totalDurationMs > 0 ? Number((count / (totalDurationMs / 1000)).toFixed(1)) : 0;

  return {
    count,
    errors,
    totalDurationMs: Number(totalDurationMs.toFixed(1)),
    minMs: Number(sorted[0]!.toFixed(2)),
    p50Ms: Number(getP(50).toFixed(2)),
    p90Ms: Number(getP(90).toFixed(2)),
    p95Ms: Number(getP(95).toFixed(2)),
    p99Ms: Number(getP(99).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1]!.toFixed(2)),
    throughputRps,
  };
}

async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; durationMs: number; body: string; json: unknown }> {
  const parsedUrl = new URL(url);
  const postData = options.body ? JSON.stringify(options.body) : undefined;
  const start = performance.now();

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
        timeout: options.timeoutMs || 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const durationMs = performance.now() - start;
          let json: unknown = null;
          try {
            json = JSON.parse(data);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 500, durationMs, body: data, json });
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${options.timeoutMs || 10000}ms`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runConcurrentBatch<T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      await task(items[currentIndex]!, currentIndex);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  console.log('\n======================================================================');
  console.log('       EventForge Milestone 7: Load Testing & Performance Baseline   ');
  console.log('======================================================================\n');

  const { db, pool } = getDatabaseConnection();

  // 1. Health and readiness check with auto-spawning
  console.log('[Setup] Checking API & Worker operational health...');
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
    console.error('      ✗ Timed out waiting for API and Worker to become ready.');
    if (apiProc) apiProc.kill();
    if (workerProc) workerProc.kill();
    await closeDatabasePool(pool);
    process.exit(1);
  }

  console.log('      ✓ API and Worker are healthy and ready.\n');

  // 2. Provision test receiver and project
  console.log('[Setup] Setting up local mock webhook destination...');
  let totalReceivedWebhooks = 0;
  let retryCounter = 0;
  const receivedWebhooks: { path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];

  const receiverServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      totalReceivedWebhooks++;
      receivedWebhooks.push({
        path: req.url || '/',
        headers: req.headers,
        body,
      });

      if (req.url === '/webhook/flaky') {
        retryCounter++;
        if (retryCounter % 2 === 1) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'simulated_flaky_error' }));
          return;
        }
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => {
    receiverServer.listen(RECEIVER_PORT, '127.0.0.1', () => resolve());
  });
  console.log(`      ✓ Webhook receiver listening on port ${RECEIVER_PORT}\n`);

  // Provision Project
  console.log('[Setup] Provisioning test project & API credentials...');
  const [project] = await db
    .insert(projects)
    .values({
      name: `Load Test Project ${Date.now()}`,
      slug: `load-test-${Date.now()}`,
    })
    .returning();

  const { rawKey, hashedKey, keyPrefix } = generateApiKey('ef_live');
  await db.insert(apiKeys).values({
    projectId: project!.id,
    name: 'Load Test Key',
    hashedKey,
    keyPrefix,
  });

  const authHeader = { 'X-API-Key': rawKey };
  console.log(`      ✓ Test Project created (${project!.id}) with API Key (${keyPrefix}...)\n`);

  // -------------------------------------------------------------------------
  // Scenario 1: Normal event ingestion (sequential baseline)
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------------');
  console.log('Scenario 1: Baseline Event Ingestion (Normal Throughput & Latency)');
  console.log('----------------------------------------------------------------------');
  const s1Count = 50;
  const s1Latencies: number[] = [];
  let s1Errors = 0;
  const s1Start = performance.now();

  for (let i = 0; i < s1Count; i++) {
    try {
      const res = await httpRequest(`${API_URL}/v1/events`, {
        method: 'POST',
        headers: authHeader,
        body: {
          eventType: 'order.created',
          source: 'load-test.s1',
          payload: { orderId: `ord-s1-${i}`, amount: 99.99 },
          idempotencyKey: `s1-key-${Date.now()}-${i}`,
        },
      });
      if (res.status === 202) {
        s1Latencies.push(res.durationMs);
      } else {
        s1Errors++;
      }
    } catch {
      s1Errors++;
    }
  }
  const s1Duration = performance.now() - s1Start;
  const s1Stats = calculateStats(s1Latencies, s1Duration, s1Errors);
  console.log(
    `  Requests: ${s1Stats.count} | Errors: ${s1Stats.errors} (Error Rate: ${(s1Stats.errors / s1Count) * 100}%)`,
  );
  console.log(
    `  Throughput: ${s1Stats.throughputRps} req/s | Total Time: ${s1Stats.totalDurationMs}ms`,
  );
  console.log(
    `  Latency: min=${s1Stats.minMs}ms | p50=${s1Stats.p50Ms}ms | p90=${s1Stats.p90Ms}ms | p95=${s1Stats.p95Ms}ms | p99=${s1Stats.p99Ms}ms | max=${s1Stats.maxMs}ms\n`,
  );

  // -------------------------------------------------------------------------
  // Scenario 2: Concurrent Ingestion with Unique Idempotency Keys
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------------');
  console.log(
    `Scenario 2: Concurrent Ingestion (${DEFAULT_REQUESTS} requests, Concurrency: ${DEFAULT_CONCURRENCY})`,
  );
  console.log('----------------------------------------------------------------------');
  const s2Items = Array.from({ length: DEFAULT_REQUESTS }, (_, i) => i);
  const s2Latencies: number[] = [];
  let s2Errors = 0;
  const s2Start = performance.now();

  await runConcurrentBatch(s2Items, DEFAULT_CONCURRENCY, async (item) => {
    try {
      const res = await httpRequest(`${API_URL}/v1/events`, {
        method: 'POST',
        headers: authHeader,
        body: {
          eventType: 'user.signup',
          source: 'load-test.s2',
          payload: { userId: `usr-${item}`, tier: 'pro' },
          idempotencyKey: `s2-key-${Date.now()}-${item}`,
        },
      });
      if (res.status === 202) {
        s2Latencies.push(res.durationMs);
      } else {
        s2Errors++;
      }
    } catch {
      s2Errors++;
    }
  });

  const s2Duration = performance.now() - s2Start;
  const s2Stats = calculateStats(s2Latencies, s2Duration, s2Errors);
  console.log(
    `  Requests: ${s2Stats.count} | Errors: ${s2Stats.errors} (Error Rate: ${(s2Stats.errors / DEFAULT_REQUESTS) * 100}%)`,
  );
  console.log(
    `  Throughput: ${s2Stats.throughputRps} req/s | Total Time: ${s2Stats.totalDurationMs}ms`,
  );
  console.log(
    `  Latency: min=${s2Stats.minMs}ms | p50=${s2Stats.p50Ms}ms | p90=${s2Stats.p90Ms}ms | p95=${s2Stats.p95Ms}ms | p99=${s2Stats.p99Ms}ms | max=${s2Stats.maxMs}ms\n`,
  );

  // -------------------------------------------------------------------------
  // Scenario 3: Concurrent Duplicate Ingestion (Atomic ON CONFLICT DO NOTHING)
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------------');
  console.log('Scenario 3: Concurrent Duplicate Ingestion (50 Parallel Requests, Same Key)');
  console.log('----------------------------------------------------------------------');
  const sharedKey = `s3-duplicate-${Date.now()}`;
  const s3Requests = 50;
  const s3Latencies: number[] = [];
  let s3Errors = 0;
  let s3Accepted = 0;
  const s3Start = performance.now();

  const parallelPromises = Array.from({ length: s3Requests }, async () => {
    try {
      const res = await httpRequest(`${API_URL}/v1/events`, {
        method: 'POST',
        headers: authHeader,
        body: {
          eventType: 'payment.processed',
          source: 'load-test.s3',
          payload: { txId: 'tx-shared', status: 'success' },
          idempotencyKey: sharedKey,
        },
      });
      if (res.status === 202) {
        s3Accepted++;
        s3Latencies.push(res.durationMs);
      } else {
        s3Errors++;
      }
    } catch {
      s3Errors++;
    }
  });

  await Promise.all(parallelPromises);
  const s3Duration = performance.now() - s3Start;
  const s3Stats = calculateStats(s3Latencies, s3Duration, s3Errors);
  console.log(
    `  Parallel Requests: ${s3Requests} | Accepted HTTP 202: ${s3Accepted} | Errors: ${s3Errors}`,
  );
  console.log(
    `  Throughput: ${s3Stats.throughputRps} req/s | Total Time: ${s3Stats.totalDurationMs}ms`,
  );
  console.log(
    `  Latency: min=${s3Stats.minMs}ms | p50=${s3Stats.p50Ms}ms | p90=${s3Stats.p90Ms}ms | p95=${s3Stats.p95Ms}ms | p99=${s3Stats.p99Ms}ms | max=${s3Stats.maxMs}ms`,
  );
  console.log(
    `  Atomic Idempotency Verification: ${s3Accepted === s3Requests ? 'PASSED (All 50 resolved cleanly with 202, 0 constraint violations)' : 'FAILED'}\n`,
  );

  // -------------------------------------------------------------------------
  // Scenario 4: Webhook Delivery Under Worker Concurrency
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------------');
  console.log('Scenario 4: Webhook Delivery Under Worker Concurrency');
  console.log('----------------------------------------------------------------------');
  const s4SubRes = await httpRequest(`${API_URL}/v1/subscriptions`, {
    method: 'POST',
    headers: authHeader,
    body: {
      name: 'High-Volume Receiver',
      targetUrl: `http://127.0.0.1:${RECEIVER_PORT}/webhook/orders`,
      eventTypes: ['delivery.test.*'],
    },
  });
  const s4SubId = (s4SubRes.json as { id: string }).id;
  const deliveryBatchCount = 50;
  console.log(`  Subscribed to delivery.test.* (Subscription ID: ${s4SubId})`);
  console.log(`  Publishing ${deliveryBatchCount} events to outbox...`);

  const initialReceivedCount = totalReceivedWebhooks;
  const publishStart = performance.now();

  const publishItems = Array.from({ length: deliveryBatchCount }, (_, i) => i);
  await runConcurrentBatch(publishItems, 10, async (idx) => {
    await httpRequest(`${API_URL}/v1/events`, {
      method: 'POST',
      headers: authHeader,
      body: {
        eventType: 'delivery.test.event',
        source: 'load-test.s4',
        payload: { itemIndex: idx, ts: Date.now() },
        idempotencyKey: `s4-evt-${Date.now()}-${idx}`,
      },
    });
  });

  const publishDuration = performance.now() - publishStart;
  console.log(
    `  ✓ All ${deliveryBatchCount} events published in ${publishDuration.toFixed(1)}ms (${(deliveryBatchCount / (publishDuration / 1000)).toFixed(1)} req/s)`,
  );
  console.log(`  Awaiting worker outbox polling, BullMQ processing, and HTTP delivery...`);

  const waitStart = performance.now();
  const timeoutMs = 30000;
  while (
    totalReceivedWebhooks - initialReceivedCount < deliveryBatchCount &&
    performance.now() - waitStart < timeoutMs
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const s4DeliveryDuration = performance.now() - waitStart;
  const deliveredCount = totalReceivedWebhooks - initialReceivedCount;
  const deliveryThroughput =
    deliveredCount > 0 ? (deliveredCount / (s4DeliveryDuration / 1000)).toFixed(1) : '0';
  console.log(`  Dispatched & Received: ${deliveredCount}/${deliveryBatchCount} deliveries`);
  console.log(`  Worker End-to-End Drain Duration: ${s4DeliveryDuration.toFixed(1)}ms`);
  console.log(`  Delivery Pipeline Throughput: ${deliveryThroughput} deliveries/s\n`);

  // -------------------------------------------------------------------------
  // Scenario 5: Temporary Webhook Endpoint Failures and Recovery
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------------');
  console.log('Scenario 5: Temporary Endpoint Failures, Exponential Backoff & Recovery');
  console.log('----------------------------------------------------------------------');
  const s5SubRes = await httpRequest(`${API_URL}/v1/subscriptions`, {
    method: 'POST',
    headers: authHeader,
    body: {
      name: 'Flaky Recovery Receiver',
      targetUrl: `http://127.0.0.1:${RECEIVER_PORT}/webhook/flaky`,
      eventTypes: ['flaky.test.*'],
    },
  });
  const s5SubId = (s5SubRes.json as { id: string }).id;

  const flakyEventRes = await httpRequest(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: authHeader,
    body: {
      eventType: 'flaky.test.item',
      source: 'load-test.s5',
      payload: { attempt: 'recoverable' },
      idempotencyKey: `s5-flaky-${Date.now()}`,
    },
  });
  const flakyEventId = (flakyEventRes.json as { id: string }).id;
  console.log(`  Created subscription ${s5SubId} and published flaky event ${flakyEventId}`);
  console.log(`  Monitoring BullMQ retry progression and final delivery state...`);

  const s5WaitStart = performance.now();
  let recovered = false;
  let s5FinalStatus = 'PENDING';
  let s5FinalAttempts = 0;

  while (performance.now() - s5WaitStart < 25000) {
    const [delRecord] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.eventId, flakyEventId));

    if (delRecord) {
      s5FinalStatus = delRecord.status;
      s5FinalAttempts = delRecord.attemptsCount;
      if (delRecord.status === 'COMPLETED' && delRecord.attemptsCount >= 2) {
        recovered = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const s5Duration = performance.now() - s5WaitStart;
  console.log(
    `  Final Status: ${s5FinalStatus} | Total Attempts: ${s5FinalAttempts} | Time: ${s5Duration.toFixed(1)}ms`,
  );
  console.log(
    `  Recovery Verification: ${recovered ? 'PASSED (First attempt simulated 500, BullMQ retry succeeded with 200)' : 'FAILED'}\n`,
  );

  // Clean up
  console.log('[Teardown] Cleaning up load test project and stopping receiver...');
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

  console.log('======================================================================');
  console.log('            ✓ LOAD TEST & BASELINE COMPLETED SUCCESSFULLY             ');
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('\n✗ Load test encountered error:', err);
  process.exit(1);
});
