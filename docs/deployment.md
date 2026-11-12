# EventForge — Production Deployment & Operations Guide

This guide details the operational procedures, Docker configuration, database management, and maintenance workflows for deploying EventForge in production environments.

---

## 1. Production Docker Architecture

EventForge uses multi-stage Docker builds based on `node:24-alpine` to minimize image footprint and enhance security.

### Key Characteristics

- **Multi-Stage Build**: Development tools (TypeScript compiler, Turbo, test frameworks) are used exclusively in the builder stage. Only compiled JavaScript (`dist/`), migrations, and production-only dependencies (reinstalled with `pnpm install --prod` after the build) are copied to the runtime image.
- **Image Size** (measured 2026-11-12 with `docker save <image> | gzip | wc -c` and `docker image ls`): ~73 MB gzip-compressed export and ~369 MB on disk, for both API and worker. The `node:24-alpine` base accounts for ~232 MB of the on-disk size.
- **Non-Root Execution**: Containers execute under the unprivileged `node` user (`UID 1000`, `GID 1000`).
- **Signal Handling**: NestJS lifecycle hooks (`enableShutdownHooks()`) capture `SIGTERM` and `SIGINT`, cleanly terminating BullMQ workers, HTTP servers, and database connection pools.
- **Native Health Checks**: Uses Node.js native `fetch` against `/v1/ready` without requiring external binaries (`curl` / `wget`).

### Building Production Images

```bash
# Build API image
docker build -f apps/api/Dockerfile -t eventforge-api:latest .

# Build Worker image
docker build -f apps/worker/Dockerfile -t eventforge-worker:latest .
```

---

## 2. Production Docker Compose

A standalone production configuration is provided in `docker-compose.prod.yml`.

### Services

| Service    | Image                      | Internal Port | Host Port          | Role                                       |
| :--------- | :------------------------- | :------------ | :----------------- | :----------------------------------------- |
| `postgres` | `postgres:16-alpine`       | `5432`        | _(None - Private)_ | Transactional event storage & outbox       |
| `redis`    | `redis:7-alpine`           | `6379`        | _(None - Private)_ | BullMQ delivery queue & retries            |
| `migrate`  | `eventforge-api:latest`    | _(none)_      | _(None - Private)_ | One-off job: applies DB migrations, exits  |
| `api`      | `eventforge-api:latest`    | `3000`        | `3000`             | Public REST API & Webhook ingestion        |
| `worker`   | `eventforge-worker:latest` | `3001`        | _(None - Private)_ | Background outbox poller & HTTP dispatcher |

### Security Boundaries

- PostgreSQL and Redis ports are kept internal to the isolated Docker network `eventforge_prod_net`.
- The worker's health/metrics server (`:3001`) is **not published** to the host. `WORKER_HOST=0.0.0.0` only makes it reachable from other containers on the internal network (it is used by the container's own healthcheck).
- The API's `/metrics` requires `Authorization: Bearer $METRICS_TOKEN`; if `METRICS_TOKEN` is unset in production the endpoint returns `404`.
- `POSTGRES_PASSWORD` is required: `docker compose` refuses to start without it. Use a value without URL-special characters (e.g. `openssl rand -hex 24`) since it is embedded in the connection string.
- The compose file sets `name: eventforge-prod`, so it never shares a project with the development `docker-compose.yml`.
- `ALLOW_LOCAL_WEBHOOKS` is strictly enforced to `false`.

### Starting Production Services

```bash
# 1. Create production environment file from template
cp .env.production.example .env.production
# Edit .env.production with your secure credentials

# 2. Build and launch services in detached mode
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# 3. View streaming logs
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
```

---

## 3. Database Management & Migrations

### Migration Execution

Migrations are managed with Drizzle ORM and stored in `packages/database/migrations/`.
The API and worker processes **never** migrate at startup. Instead, `docker-compose.prod.yml` defines a one-off `migrate` service (the API image running `packages/database/dist/scripts/migrate.js`). `api` and `worker` declare `depends_on: migrate: condition: service_completed_successfully`, so on every `docker compose up` migrations run first, and a failed migration stops the deploy rather than starting new code against an old schema. On an empty database this creates the full schema; on an up-to-date database it is a no-op.

```bash
# Re-run migrations manually if needed
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
```

Tenant projects and API keys are created with the admin CLI inside the running API container:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  node packages/database/dist/scripts/admin.js project:create --name "Acme" --slug acme
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  node packages/database/dist/scripts/admin.js key:create --project acme --name "prod"
```

### Smoke Testing a Running Stack

`pnpm smoke-test:remote` verifies a running production-configured stack using only its public HTTP surface (plus the admin CLI to mint a throwaway key, which it revokes afterwards). It checks health and readiness, security headers, authentication (401 without or with an invalid key), SSRF rejection of private targets, event ingestion and idempotency, event detail (with its deliveries) and `GET /v1/stats`, the dashboard at `/dashboard` (HTML served uncached, client-side route fallback, same-origin CSP, no third-party resources, immutable hashed assets, 404 for a missing file), the sandbox endpoint (404 when sandbox mode is off, 201 with a key when on), `/metrics` protection, and that the worker port is closed.

```bash
# Against the local production compose stack
METRICS_TOKEN=<your token> pnpm smoke-test:remote

# Against a deployed server (create a key with the admin CLI first)
API_URL=https://your-host SMOKE_API_KEY=<key> METRICS_TOKEN=<token> pnpm smoke-test:remote
```

It does **not** prove webhook delivery, because production only delivers to public URLs (local targets are blocked by SSRF protection). Delivery is covered by `pnpm smoke-test` (which spawns the built API and worker locally) and the integration tests.

### Dashboard and Sandbox

The dashboard is built with the rest of the workspace (`pnpm build`) and the API serves it at `/dashboard` from the same container; the Dockerfile copies the bundle in, so there is nothing extra to run or expose. If the bundle is missing the API logs a warning and `/dashboard` returns 404. The dashboard has its own Content-Security-Policy (same-origin scripts, fonts and connections; inline styles allowed because Radix UI and Recharts inject `<style>` elements), while the API and `/docs` keep theirs.

Sandbox mode is **off** by default. To run a public demo set `SANDBOX_ENABLED=true` and `SANDBOX_RECEIVER_URL` (how the **worker** reaches the API's demo receiver, `http://api:3000/sandbox/receiver` in the prod compose network) on both the API and the worker, and tune `SANDBOX_SESSIONS_PER_HOUR` / `SANDBOX_WRITES_PER_HOUR`. Visitors get a one-hour key to one shared `sandbox` project, so they can see each other's events. The receiver URL is the only private address the worker is allowed to call; every other target still goes through SSRF checks. Check the result with `pnpm smoke-test:remote`.

### PostgreSQL Backup Procedure

Run a consistent, atomic snapshot using `pg_dump`:

```bash
# Create custom-format compressed backup
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d eventforge -Fc > "eventforge_backup_$(date +%Y%m%d_%H%M%S).dump"

# Create plain SQL schema + data backup
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d eventforge --clean --if-exists > "eventforge_backup_$(date +%Y%m%d_%H%M%S).sql"
```

### PostgreSQL Restore Procedure

Restore from a custom-format dump using `pg_restore`:

```bash
# 1. Drop existing connections and restore
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U postgres -d eventforge --clean --if-exists < eventforge_backup_YYYYMMDD_HHMMSS.dump

# 2. Verify schema and table counts
pnpm --filter @eventforge/database db:verify
```

---

## 4. Secret Generation & Rotation

### API Key Generation

Tenant API keys use the format `ef_<env>_<32_random_bytes_base64url>`.
Only SHA-256 hashes (`keyHash`) and prefixes (`keyPrefix`) are stored in PostgreSQL. Raw keys are never stored and cannot be recovered if lost.

```typescript
import { generateApiKey } from '@eventforge/common';

const { rawKey, keyHash, keyPrefix } = generateApiKey('live');
// Share rawKey once with the tenant.
// Store keyHash and keyPrefix in the api_keys table.
```

### Rotation Workflow

1. Generate a new API key for the tenant's project:
   ```sql
   INSERT INTO api_keys (project_id, name, key_hash, key_prefix)
   VALUES ('<project_id>', 'Production Key (Rotated)', '<new_hash>', '<new_prefix>');
   ```
2. Tenant updates their client applications to authenticate with the new raw key.
3. Once verified, revoke the old key:
   ```sql
   DELETE FROM api_keys WHERE project_id = '<project_id>' AND key_prefix = '<old_prefix>';
   ```

### Webhook Signing Secrets

Webhook endpoints are signed using HMAC-SHA256 with secrets formatted as `whsec_<32_random_bytes_hex>`.
The secret is returned once, when the subscription is created, and is never returned by any read or update
endpoint. A subscription's secret cannot be changed, so to rotate it:

1. Create a new subscription for the same target URL and event types; save the `signingSecret` from its response.
2. In the downstream consumer, configure the `@eventforge/sdk` to verify signatures against both the new and the old
   secret during the migration window.
3. Once the consumer is verified, disable the old subscription (`PATCH /v1/subscriptions/:id` with `{ "isActive": false }`)
   or delete it. Deleting also removes that subscription's delivery history.

---

## 5. Monitoring, Health Checks & Observability

### Health Endpoints

- **Liveness**: `GET /v1/health` (Returns HTTP 200 `{ status: "ok" }`).
- **Readiness**: `GET /v1/ready` (Returns HTTP 200 with dependency checks `{ database: "up", redis: "up" }`). Returns HTTP 503 if any dependency is degraded.

### Prometheus Metrics

Both runtimes expose Prometheus metrics at `/v1/metrics`. The API endpoint requires the `METRICS_TOKEN` bearer token in production; the worker endpoint is reachable only from inside the Docker network (it is not published):

- **API Metrics** (`:3000/v1/metrics`):
  - `eventforge_http_requests_total`
  - `eventforge_http_request_duration_seconds`
  - `eventforge_events_accepted_total`
  - `eventforge_events_rejected_total`
  - `eventforge_outbox_pending_gauge` (cached 15s)
  - `eventforge_outbox_dead_letter_gauge` (cached 15s)

- **Worker Metrics** (`:3001/v1/metrics`):
  - `eventforge_delivery_attempts_total`
  - `eventforge_deliveries_success_total`
  - `eventforge_deliveries_failed_total`
  - `eventforge_outbox_dead_letter_total`
  - `eventforge_queue_waiting_jobs_gauge`
  - `eventforge_queue_active_jobs_gauge`
  - `eventforge_queue_delayed_jobs_gauge`

---

## 6. Troubleshooting & Diagnostics

### Outbox Backlog

If `eventforge_outbox_pending_gauge` increases monotonically:

1. Check worker logs: `docker compose --env-file .env.production -f docker-compose.prod.yml logs worker`.
2. Verify Redis connectivity: `docker compose --env-file .env.production -f docker-compose.prod.yml exec redis redis-cli ping`.
3. Check PostgreSQL connection pool: verify `DATABASE_MAX_CONNECTIONS` is sufficient.

### Dead-Letter Queue Triage

Deliveries transitioning to `DEAD_LETTER` indicate repeated failures (e.g., downstream consumer returned 5xx or timed out across all 5 retry attempts).

1. Query DLQ deliveries via API:
   ```bash
   curl -H "X-API-Key: $API_KEY" "http://localhost:3000/v1/deliveries?status=DEAD_LETTER"
   ```
2. Inspect individual delivery and attempt history:
   ```bash
   curl -H "X-API-Key: $API_KEY" "http://localhost:3000/v1/deliveries/<delivery_id>"
   ```
3. Replay when downstream endpoint is fixed:
   ```bash
   curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"additionalAttempts": 3}' \
     "http://localhost:3000/v1/deliveries/<delivery_id>/replay"
   ```
