# EventForge

EventForge is a production-grade, reliable event-processing and webhook delivery platform built as a modular monolith with separate API and background worker runtimes.

## Monorepo Architecture

The repository is organized as a **pnpm workspace** orchestrated by **Turborepo**:

```text
EventForge/
├── apps/
│   ├── api/                   # NestJS REST API (ingestion, tenant auth, Swagger)
│   └── worker/                # NestJS background worker (polling outbox, BullMQ, delivery)
├── packages/
│   ├── common/                # Shared domain contracts, envelope types, HMAC utilities, SSRF
│   ├── config/                # Validated environment configuration schemas
│   ├── database/              # Drizzle ORM schema, migrations, connection pool, transactions
│   └── typescript-config/     # Strict shared tsconfig inheritance bases
├── docker-compose.yml         # Local PostgreSQL 16 & Redis 7 services
├── .editorconfig              # Editor indentation & formatting standards
├── .env.example               # Template environment configuration
├── .prettierrc                # Root formatting rules
├── eslint.config.mjs          # Root flat ESLint configuration
├── package.json               # Root scripts & dev tooling
├── pnpm-workspace.yaml        # Workspace membership definition
└── turbo.json                 # Turborepo task pipeline & caching rules
```

## Architectural Boundaries & Principles

1. **Unidirectional Dependencies**:
   - Applications (`apps/*`) depend on shared packages (`packages/*`).
   - Packages **never** depend on applications.
   - `@eventforge/common` is a zero-dependency leaf package containing pure domain primitives, HMAC cryptographic helpers, and SSRF address validators.
   - `@eventforge/config` provides strongly typed, Zod-validated environment configurations.
   - `@eventforge/database` is the sole persistence layer, shared across both API and Worker.

2. **Domain Model Integrity**:
   - **Project**: Tenant namespace.
   - **API Key**: Hashed credential (SHA-256) for ingestion authentication. Raw secret keys are displayed once and never stored.
   - **Event**: Immutable ingested business event payload with idempotency key.
   - **Outbox Record**: Transactional buffer decoupling ingestion from scheduling via `FOR UPDATE SKIP LOCKED`.
   - **Subscription**: Target webhook endpoint configuration, filters, and signing secret.
   - **Delivery**: Logical delivery intent matching an event to a subscription (`UNIQUE (event_id, subscription_id)`).
   - **Delivery Attempt**: Append-only execution audit log capturing HTTP status, duration, and bounded redacted snippets.

3. **Background Worker Lifecycle & Semantics**:
   - **At-Least-Once Delivery**: Events are reliably fanned out to matching subscriptions. If network failures occur, retries with jittered exponential backoff guarantee delivery attempts.
   - **No Database Locks Across I/O**: PostgreSQL transactions claim outbox batches using `FOR UPDATE SKIP LOCKED` and immediately release the transaction. BullMQ job enqueueing and HTTP dispatching run outside open database transactions.
   - **Delivery-Time SSRF & DNS-Rebinding Protection**: Target URLs are validated at subscription registration and re-verified at connection time via custom DNS lookup and dialed TCP socket inspection before any payload bytes are transmitted.
   - **Redis Crash Recovery**: Stale claim recovery scans PostgreSQL (the single source of truth) for unfulfilled deliveries (`FAILED` with `next_retry_at <= NOW()` or abandoned `IN_FLIGHT`), re-enqueuing them without data loss.

## Prerequisites

- **Node.js**: `v24.19.0` (or `>= 24.0.0`)
- **pnpm**: `11.21.0` (or `>= 11.0.0`)
- **Docker & Docker Compose**: For local PostgreSQL 16 and Redis 7

## Quick Start & Local Setup

### 1. Configure Environment Variables

Copy the template environment file:

```bash
cp .env.example .env
```

### 2. Start Local Infrastructure

Launch PostgreSQL and Redis containers with health checks:

```bash
pnpm docker:up
```

Verify service status:

```bash
docker ps
```

### 3. Run Database Migrations

Apply Drizzle schema migrations to PostgreSQL:

```bash
pnpm db:migrate
```

### 4. Seed Development Data

Seed a demo project, generate a test API key, and configure a local webhook subscription:

```bash
pnpm db:seed
```

### 5. Verify Integration

Run the automated schema and transactional outbox verification script:

```bash
pnpm db:verify
```

## Running Applications

You can run both runtimes simultaneously in separate terminals:

```bash
# Terminal 1: REST API Application (Port 3000)
pnpm dev:api

# Terminal 2: Background Worker Application
pnpm dev:worker
```

## Development Commands

All workspace tasks are coordinated through Turborepo from the repository root:

| Command                 | Description                                                 |
| :---------------------- | :---------------------------------------------------------- |
| `pnpm build`            | Compile all packages and applications in topological order  |
| `pnpm dev`              | Run development servers in watch mode with streaming logs   |
| `pnpm dev:api`          | Start NestJS API in hot-reload development mode             |
| `pnpm start:api`        | Start compiled NestJS API production server                 |
| `pnpm dev:worker`       | Start NestJS Background Worker in hot-reload mode           |
| `pnpm start:worker`     | Start compiled NestJS Background Worker production runtime  |
| `pnpm demo`             | Run the automated end-to-end lifecycle demonstration        |
| `pnpm lint`             | Run ESLint across all files                                 |
| `pnpm lint:fix`         | Automatically fix ESLint warnings and errors                |
| `pnpm typecheck`        | Run TypeScript typechecking across workspace packages       |
| `pnpm test`             | Run test suites across all packages                         |
| `pnpm test:unit`        | Run unit tests (guards, filters, SSRF validators, worker)   |
| `pnpm test:integration` | Run database integration tests with tenant isolation checks |
| `pnpm format:check`     | Verify formatting with Prettier                             |
| `pnpm format:write`     | Format codebase with Prettier                               |
| `pnpm docker:up`        | Start PostgreSQL 16 and Redis 7 in background               |
| `pnpm docker:down`      | Stop and remove local Docker containers                     |
| `pnpm docker:logs`      | Tail logs from Docker containers                            |
| `pnpm db:generate`      | Generate SQL migration from Drizzle schema definitions      |
| `pnpm db:migrate`       | Execute pending SQL migrations against PostgreSQL           |
| `pnpm db:seed`          | Populate database with development seed data                |
| `pnpm db:verify`        | Run end-to-end database and outbox verification script      |

## API Endpoints

The API server runs on `http://localhost:3000` with OpenAPI documentation at `http://localhost:3000/docs`.

### Authentication

All operational endpoints require authentication via the `X-API-Key: ef_live_...` header (or `Authorization: Bearer ef_live_...`).

### Summary of Endpoints

- **Health & Probes**:
  - `GET /v1/health` (and `GET /health`): Liveness probe (public).
  - `GET /v1/ready` (and `GET /ready`): Readiness probe verifying PostgreSQL and Redis health (public).
- **Observability & Metrics**:
  - `GET /v1/metrics` (and `GET /metrics`): Prometheus metrics scrape endpoint (public).
  - Worker metrics at `http://localhost:3001/metrics`: BullMQ queue gauges, delivery attempts, and latencies.
- **Event Ingestion & Retrieval**:
  - `POST /v1/events`: Ingest business event (atomically writes event + outbox, returns `202 Accepted`).
  - `GET /v1/events`: List project events with pagination and filters (`limit`, `page`, `eventType`, `source`, `from`, `to`).
  - `GET /v1/events/:id`: Retrieve single event by UUID (scoped to tenant).
- **Webhook Subscriptions**:
  - `POST /v1/subscriptions`: Register destination URL with SSRF protection; returns generated HMAC signing secret once.
  - `GET /v1/subscriptions`: List project subscriptions (signing secrets strictly omitted).
  - `GET /v1/subscriptions/:id`: Retrieve subscription by UUID (signing secrets strictly omitted).
  - `PATCH /v1/subscriptions/:id`: Update subscription destination or configuration.
  - `DELETE /v1/subscriptions/:id`: Delete subscription (`204 No Content`).

## Webhook Delivery Details

- **Outbound HTTP Method**: `POST`
- **Standard Headers**:
  - `Content-Type: application/json`
  - `User-Agent: EventForge-Webhook/1.0`
  - `X-EventForge-Event-Id: <UUID>`
  - `X-EventForge-Delivery-Id: <UUID>`
  - `X-EventForge-Timestamp: <UNIX_SECONDS>`
  - `X-EventForge-Signature: t=<TIMESTAMP>,v1=<HMAC_SHA256_HEX>`
- **Payload Structure**:
  ```json
  {
    "id": "e30c8ad7-c4e9-4679-b1ba-10e3fc80d6ae",
    "event": "order.completed",
    "source": "billing-service",
    "timestamp": "2026-10-26T08:00:00.000Z",
    "data": {
      "orderId": "ord_1001",
      "amount": 9900
    }
  }
  ```
- **Retry Strategy**:
  - 429 status code parses `Retry-After` header (seconds or HTTP date).
  - 5xx errors and network timeouts execute randomized jittered exponential backoff.
  - 4xx client errors (e.g. 400, 401, 404) and SSRF violations immediately transition to `DEAD_LETTER` without retrying.

## End-to-End Operational Lifecycle Demo

EventForge provides an automated end-to-end demonstration verifying event publication, transactional outbox fanout, BullMQ queueing, HMAC-SHA256 signature verification, retry backoff, and Prometheus metrics.

### Automated Run

Ensure Docker services are running (`pnpm docker:up`), then run:

```bash
pnpm demo
```

The script autonomously:

1. Starts a safe local test receiver on `http://127.0.0.1:4040/webhook/*`.
2. Connects to PostgreSQL and verifies API and Worker readiness (auto-spawning them if not already running).
3. Provisions a demo project and active API key.
4. Creates a webhook subscription pointing to the local test receiver.
5. Ingests an `order.created` event into PostgreSQL atomically with an outbox record.
6. Awaits webhook receipt, validates headers, and performs HMAC-SHA256 signature verification.
7. Demonstrates a transient 500 failure, exponential backoff, BullMQ retry, and eventual success (`attemptsCount = 2`).
8. Samples live Prometheus metrics from `/v1/metrics`.

### Manual Step-by-Step Walkthrough

If you prefer to inspect each step manually:

1. **Verify Health**:

   ```bash
   curl -s http://localhost:3000/v1/health | jq
   curl -s http://localhost:3000/v1/ready | jq
   curl -s http://localhost:3001/v1/health | jq
   ```

2. **Obtain an API Key**:
   Run `pnpm db:seed` to retrieve a generated API key, or use your provisioned tenant key.

3. **Create a Subscription**:

   ```bash
   curl -s -X POST http://localhost:3000/v1/subscriptions \
     -H "Content-Type: application/json" \
     -H "X-API-Key: ef_live_YOUR_KEY" \
     -d '{
       "name": "Order Notifications",
       "targetUrl": "https://webhook.site/your-uuid",
       "eventTypes": ["order.*"]
     }' | jq
   ```

4. **Publish an Event**:

   ```bash
   curl -s -X POST http://localhost:3000/v1/events \
     -H "Content-Type: application/json" \
     -H "X-API-Key: ef_live_YOUR_KEY" \
     -d '{
       "eventType": "order.created",
       "source": "storefront.checkout",
       "payload": {
         "orderId": "ord_1002",
         "amount": 99.95
       }
     }' | jq
   ```

5. **Inspect Prometheus Metrics**:
   ```bash
   # API metrics (events accepted, request duration, outbox gauge)
   curl -s http://localhost:3000/v1/metrics | grep eventforge_

   # Worker metrics (delivery attempts, BullMQ queue backlog, latencies)
   curl -s http://localhost:3001/v1/metrics | grep eventforge_
   ```

See [`docs/observability.md`](docs/observability.md) for full metrics definitions and logging schema.

## Troubleshooting

### Port Conflicts

If port `5432` or `6379` is already bound by a local service:

```bash
ss -tuln | grep -E ':(5432|6379)\b'
```

Update the port mappings in `docker-compose.yml` and adjust `DATABASE_URL` or `REDIS_URL` in `.env` accordingly.

### PostgreSQL Connection Issues

Ensure the PostgreSQL container is reporting healthy before running migrations:

```bash
docker inspect --format='{{json .State.Health.Status}}' eventforge-postgres
```

Expected output: `"healthy"`.
