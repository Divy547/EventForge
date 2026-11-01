# EventForge — Production Deployment & Operations Guide

This guide details the operational procedures, Docker configuration, database management, and maintenance workflows for deploying EventForge in production environments.

---

## 1. Production Docker Architecture

EventForge uses multi-stage Docker builds based on `node:24-alpine` to minimize image footprint and enhance security.

### Key Characteristics

- **Multi-Stage Build**: Development tools (TypeScript compiler, Turbo, test frameworks) are used exclusively in the builder stage. Only compiled JavaScript (`dist/`), migrations, and pruned production dependencies (`pnpm prune --prod`) are copied to the runtime image.
- **Minimal Image Size**: Compressed runtime images are approximately ~77 MB (~370 MB uncompressed virtual size).
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
| `api`      | `eventforge-api:latest`    | `3000`        | `3000`             | Public REST API & Webhook ingestion        |
| `worker`   | `eventforge-worker:latest` | `3001`        | `3001`             | Background outbox poller & HTTP dispatcher |

### Security Boundaries

- PostgreSQL and Redis ports are kept internal to the isolated Docker network `eventforge_prod_net`.
- `WORKER_HOST` is bound to `0.0.0.0` inside the container to allow health monitoring and Prometheus scraping across the internal network.
- `ALLOW_LOCAL_WEBHOOKS` is strictly enforced to `false`.

### Starting Production Services

```bash
# 1. Create production environment file from template
cp .env.production.example .env.production
# Edit .env.production with your secure credentials

# 2. Build and launch services in detached mode
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 3. View streaming logs
docker compose -f docker-compose.prod.yml logs -f
```

---

## 3. Database Management & Migrations

### Migration Execution

Migrations are managed with Drizzle ORM and stored in `packages/database/migrations/`.
EventForge **never** runs destructive migrations automatically at application startup. Migrations must be applied explicitly during deployment.

```bash
# Run migrations using the compiled Node.js runner (recommended for production)
pnpm db:migrate:prod

# Alternatively, inside container environment
docker compose -f docker-compose.prod.yml run --rm api node packages/database/dist/scripts/migrate.js
```

### PostgreSQL Backup Procedure

Run a consistent, atomic snapshot using `pg_dump`:

```bash
# Create custom-format compressed backup
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d eventforge -Fc > "eventforge_backup_$(date +%Y%m%d_%H%M%S).dump"

# Create plain SQL schema + data backup
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d eventforge --clean --if-exists > "eventforge_backup_$(date +%Y%m%d_%H%M%S).sql"
```

### PostgreSQL Restore Procedure

Restore from a custom-format dump using `pg_restore`:

```bash
# 1. Drop existing connections and restore
docker compose -f docker-compose.prod.yml exec -T postgres \
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
To rotate an endpoint signing secret:

1. Update the subscription in EventForge with a newly generated secret.
2. In the downstream consumer, configure the `@eventforge/sdk` to verify signatures against both the new secret and old secret during the migration window.

---

## 5. Monitoring, Health Checks & Observability

### Health Endpoints

- **Liveness**: `GET /v1/health` (Returns HTTP 200 `{ status: "ok" }`).
- **Readiness**: `GET /v1/ready` (Returns HTTP 200 with dependency checks `{ database: "up", redis: "up" }`). Returns HTTP 503 if any dependency is degraded.

### Prometheus Metrics

Both the API and background worker expose Prometheus metrics at `/v1/metrics`:

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

1. Check worker logs: `docker compose -f docker-compose.prod.yml logs worker`.
2. Verify Redis connectivity: `docker compose -f docker-compose.prod.yml exec redis redis-cli ping`.
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
