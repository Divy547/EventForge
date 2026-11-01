# EventForge

EventForge is a production-grade, reliable event-processing and webhook delivery platform built as a modular monolith with separate API and background worker runtimes.

---

## System Architecture & Highlights

- **Transactional Outbox Pattern**: Ingests events and outbox records in a single atomic PostgreSQL transaction. Guarantees zero message loss without dual-write race conditions.
- **Atomic Idempotency**: Resolves concurrent duplicate requests with `ON CONFLICT (project_id, idempotency_key) DO NOTHING`, returning HTTP 202 without constraint violations.
- **At-Least-Once Delivery**: Outbox dispatcher fans out events to matching subscriptions. Worker claims jobs using `FOR UPDATE SKIP LOCKED` and dispatches webhooks via Redis/BullMQ.
- **Exponential Backoff & Jitter**: Automatically retries transient failures (5xx, 429 with `Retry-After`, network timeouts) with exponential backoff and randomized full jitter.
- **Dead-Letter Queue (DLQ) & Atomic Replay**: Exhausted or non-retryable deliveries transition to `DEAD_LETTER`. Single and batch replay endpoints safely reset state to `PENDING` with increased attempt headroom while preserving audit history.
- **SSRF & DNS-Rebinding Protection**: Validates target URLs at subscription time and performs socket-level IP address verification at connection time before sending payloads.
- **Consumer SDK (`@eventforge/sdk`)**: Lightweight TypeScript SDK for downstream webhook receivers, featuring constant-time HMAC-SHA256 verification, replay attack tolerance, and in-memory idempotency deduplication.
- **W3C Distributed Tracing**: Full end-to-end trace propagation (`traceparent`) from API ingestion through PostgreSQL outbox and BullMQ to outbound HTTP webhook headers.
- **Full Observability**: Prometheus metrics at `/v1/metrics`, structured JSON logging with automated redaction of sensitive credentials, and container readiness probes.
- **Production Containerization**: Multi-stage Dockerfiles (`node:24-alpine`) with non-root runtime users (`node`), minimal ~77 MB layer footprints, and standalone production Docker Compose.

---

## Monorepo Layout

```text
EventForge/
├── apps/
│   ├── api/                   # NestJS REST API (ingestion, tenant auth, DLQ replay, Swagger)
│   └── worker/                # NestJS background worker (polling outbox, BullMQ, delivery)
├── packages/
│   ├── common/                # Domain types, HMAC crypto, SSRF validation, W3C tracing, logger
│   ├── config/                # Validated environment schemas & production security guardrails
│   ├── database/              # Drizzle ORM schema, migrations, connection pool, transactions
│   ├── sdk/                   # Official consumer webhook verification & deduplication SDK
│   └── typescript-config/     # Strict shared tsconfig inheritance bases
├── docs/
│   ├── architecture.md        # In-depth architectural semantics, lifecycle state machines
│   ├── deployment.md          # Production deployment, Docker, migrations, backup & restore
│   └── observability.md       # Metrics catalog, logging schemas, and alerting thresholds
├── scripts/
│   ├── demo.ts                # Autonomous end-to-end verification & lifecycle demonstration
│   ├── load-test.ts           # 5-scenario reproducible load testing harness & benchmarking
│   └── smoke-test.ts          # 11-step production deployment smoke test
├── docker-compose.yml         # Local development Compose (PostgreSQL 16 & Redis 7)
├── docker-compose.prod.yml    # Production Compose (API, Worker, Private PostgreSQL & Redis)
├── .env.example               # Development environment template
├── .env.production.example    # Production environment template with security guidelines
├── .github/workflows/ci.yml   # Complete CI/CD pipeline (lint, typecheck, tests, docker builds)
├── package.json               # Root scripts & dev tooling
├── pnpm-workspace.yaml        # Workspace membership definition
└── turbo.json                 # Turborepo task pipeline & caching rules
```

---

## Prerequisites

- **Node.js**: `v24.19.0` (or `>= 24.0.0`)
- **pnpm**: `11.21.0` (or `>= 11.0.0`)
- **Docker & Docker Compose**: Docker Engine 24+ and Compose v2+

---

## Quick Start (Local Development)

### 1. Configure Environment

```bash
cp .env.example .env
```

### 2. Start PostgreSQL & Redis

```bash
pnpm docker:up
```

### 3. Apply Migrations & Seed Data

```bash
pnpm db:migrate
pnpm db:seed
```

### 4. Run Development Servers

```bash
# Terminal 1: REST API Application (Port 3000)
pnpm dev:api

# Terminal 2: Background Worker Application (Port 3001)
pnpm dev:worker
```

### 5. Run the Automated Demo

```bash
pnpm demo
```

---

## Production Deployment

### 1. Production Docker Images

Build minimal, multi-stage production images with non-root runtime users:

```bash
# Build API image
docker build -f apps/api/Dockerfile -t eventforge-api:latest .

# Build Worker image
docker build -f apps/worker/Dockerfile -t eventforge-worker:latest .
```

### 2. Production Docker Compose

EventForge provides a production-hardened compose specification in `docker-compose.prod.yml`:

- Keeps database and Redis ports private inside `eventforge_prod_net`.
- Binds `WORKER_HOST=0.0.0.0` for container metrics scraping.
- Rejects insecure settings (`ALLOW_LOCAL_WEBHOOKS=false` enforced).

```bash
# 1. Setup production environment
cp .env.production.example .env.production
# Edit .env.production with your secure database password

# 2. Launch production stack
pnpm docker:prod:up

# 3. Apply migrations in production
pnpm db:migrate:prod
```

For complete backup, restore, rotation, and scaling procedures, see [`docs/deployment.md`](docs/deployment.md).

---

## Workspace Commands

All workspace commands are orchestrated through Turborepo from the root:

| Command                 | Description                                                    |
| :---------------------- | :------------------------------------------------------------- |
| `pnpm build`            | Compile all packages and applications in topological order     |
| `pnpm dev`              | Run development servers in watch mode with streaming logs      |
| `pnpm dev:api`          | Start NestJS API in hot-reload development mode                |
| `pnpm dev:worker`       | Start NestJS Background Worker in hot-reload mode              |
| `pnpm start:api`        | Start compiled NestJS API production server                    |
| `pnpm start:worker`     | Start compiled NestJS Background Worker production server      |
| `pnpm lint`             | Run ESLint across all workspace files                          |
| `pnpm lint:fix`         | Automatically fix ESLint warnings and errors                   |
| `pnpm typecheck`        | Run TypeScript typechecking across all workspace packages      |
| `pnpm test`             | Run all test suites across all packages                        |
| `pnpm test:unit`        | Run fast isolated unit tests                                   |
| `pnpm test:integration` | Run database integration tests against real PostgreSQL & Redis |
| `pnpm format:check`     | Verify formatting with Prettier                                |
| `pnpm format:write`     | Format codebase with Prettier                                  |
| `pnpm demo`             | Run automated end-to-end lifecycle demonstration               |
| `pnpm load-test`        | Run 5-scenario performance baseline & load test                |
| `pnpm smoke-test`       | Run 11-step production deployment smoke test                   |
| `pnpm db:migrate`       | Execute pending SQL migrations against PostgreSQL              |
| `pnpm db:migrate:prod`  | Execute migrations using compiled production runner            |
| `pnpm db:seed`          | Populate database with demo project, API key, and subscription |
| `pnpm db:verify`        | Run database and outbox verification script                    |
| `pnpm docker:up`        | Start local PostgreSQL and Redis containers                    |
| `pnpm docker:down`      | Stop local development containers                              |
| `pnpm docker:prod:up`   | Build and start full production Docker Compose stack           |
| `pnpm docker:prod:down` | Stop production Docker Compose stack                           |

---

## API & Consumer SDK Usage

### Authentication

Pass the project API key in the `X-API-Key` header:

```http
X-API-Key: ef_live_YOUR_API_KEY
```

### 1. Ingest Event

```bash
curl -X POST http://localhost:3000/v1/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ef_live_YOUR_KEY" \
  -d '{
    "eventType": "order.completed",
    "source": "storefront.checkout",
    "payload": { "orderId": "ord_1001", "amount": 149.50 },
    "idempotencyKey": "order-1001-charge"
  }'
```

Response: `HTTP 202 Accepted`

```json
{
  "id": "a40ca791-904b-43e5-9d62-db6c14df8483",
  "eventType": "order.completed",
  "status": "ACCEPTED",
  "idempotencyKey": "order-1001-charge",
  "createdAt": "2026-10-30T08:00:00.000Z"
}
```

### 2. Register Webhook Subscription

```bash
curl -X POST http://localhost:3000/v1/subscriptions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ef_live_YOUR_KEY" \
  -d '{
    "name": "Order Fulfillment Receiver",
    "targetUrl": "https://api.mycompany.com/webhooks/orders",
    "eventTypes": ["order.*"]
  }'
```

Response: `HTTP 201 Created`

```json
{
  "id": "2087ddbb-7eac-4692-a996-ab63642724bf",
  "name": "Order Fulfillment Receiver",
  "targetUrl": "https://api.mycompany.com/webhooks/orders",
  "eventTypes": ["order.*"],
  "isActive": true,
  "signingSecret": "whsec_34f9a0b1c2d3..."
}
```

### 3. Inspect & Replay Dead-Letter Deliveries

```bash
# Query dead-letter deliveries
curl -H "X-API-Key: ef_live_YOUR_KEY" "http://localhost:3000/v1/deliveries?status=DEAD_LETTER"

# Replay a specific dead-letter delivery
curl -X POST http://localhost:3000/v1/deliveries/014a58f0-06be-4468-9795-33a318f8be21/replay \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ef_live_YOUR_KEY" \
  -d '{ "additionalAttempts": 3 }'

# Batch replay up to 100 dead-letter deliveries
curl -X POST http://localhost:3000/v1/deliveries/replay \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ef_live_YOUR_KEY" \
  -d '{
    "deliveryIds": ["014a58f0-06be-4468-9795-33a318f8be21"],
    "additionalAttempts": 3
  }'
```

### 4. Consumer Verification with `@eventforge/sdk`

Downstream consumers can use the official `@eventforge/sdk` package for signature verification and idempotency deduplication:

```typescript
import express from 'express';
import { EventForgeWebhook, MemoryIdempotencyStore } from '@eventforge/sdk';

const app = express();
const idempotencyStore = new MemoryIdempotencyStore({ ttlSeconds: 86400 });

// Ensure raw body is preserved for signature verification
app.use(express.raw({ type: 'application/json' }));

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-eventforge-signature'] as string;
  const rawBody = req.body.toString('utf8');

  try {
    const event = EventForgeWebhook.constructEvent({
      payload: rawBody,
      signatureHeader: signature,
      secret: process.env.WEBHOOK_SECRET!,
      toleranceSeconds: 300, // 5-minute clock-skew tolerance
    });

    // Idempotency check: prevent processing duplicate deliveries
    if (idempotencyStore.has(event.id)) {
      return res.status(200).json({ status: 'already_processed' });
    }

    // Process event
    console.log(`Processing event ${event.id}:`, event.payload);
    idempotencyStore.set(event.id);

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }
});
```

---

## Load Testing & Performance Baseline

EventForge includes a configurable load-testing suite in `scripts/load-test.ts` testing 5 scenarios:

1. **Normal Sequential Baseline**: Single-thread throughput and latency baseline.
2. **Concurrent Ingestion**: High-concurrency publication with unique idempotency keys.
3. **Concurrent Duplicate Ingestion**: Parallel requests with identical idempotency keys testing atomic `ON CONFLICT DO NOTHING`.
4. **Webhook Delivery Under Worker Concurrency**: Measures end-to-end worker delivery pipeline latency and throughput.
5. **Temporary Endpoint Failure & Recovery**: Simulates 500 server errors, verifies BullMQ exponential retry progression and eventual success.

### Running Load Tests

```bash
# Execute load test with default parameters (200 requests, 20 concurrency)
pnpm load-test

# Configurable parameters
LOAD_TEST_REQUESTS=500 LOAD_TEST_CONCURRENCY=50 pnpm load-test
```

---

## Documentation Links

- **Architecture & Delivery Semantics**: [`docs/architecture.md`](docs/architecture.md)
- **Production Deployment & Runbook**: [`docs/deployment.md`](docs/deployment.md)
- **Metrics, Logging & Observability**: [`docs/observability.md`](docs/observability.md)
