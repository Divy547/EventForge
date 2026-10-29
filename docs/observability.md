# EventForge Observability & Operational Architecture

This document describes the observability infrastructure implemented in EventForge Milestone 5, including Prometheus metrics, structured logging, health checking, and operational runbooks.

---

## 1. Metrics Instrumentation

EventForge exposes native, zero-dependency Prometheus exposition format (`version 0.0.4`) endpoints across both runtimes:

- **API Metrics**: `http://localhost:3000/metrics` or `http://localhost:3000/v1/metrics`
- **Worker Metrics**: `http://localhost:3001/metrics` or `http://localhost:3001/v1/metrics`

### Metric Definitions

| Metric Name                                | Type      | Labels                                 | Description                                                                             | Limitations / Accuracy Notes                                                   |
| :----------------------------------------- | :-------- | :------------------------------------- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| `eventforge_events_accepted_total`         | Counter   | `event_type`, `is_duplicate`           | Count of ingested business events accepted into PostgreSQL                              | Monotonically increasing counter per API process. Reset on process restart.    |
| `eventforge_events_rejected_total`         | Counter   | `reason`                               | Count of event ingestion attempts rejected before acceptance (e.g. `payload_too_large`) | Tracks pre-persistence rejections.                                             |
| `eventforge_http_requests_total`           | Counter   | `method`, `route`, `status_code_class` | Total inbound HTTP requests to the REST API                                             | Routes are parameterized (`:id`) to maintain strictly bounded cardinality.     |
| `eventforge_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code_class` | Inbound API request execution duration in seconds                                       | Bucketed between 5ms and 5s.                                                   |
| `eventforge_delivery_attempts_total`       | Counter   | `status_code_class`, `error_code`      | Total HTTP dispatch attempts executed by worker                                         | Incremented on every attempted wire transmission.                              |
| `eventforge_deliveries_success_total`      | Counter   | _none_                                 | Webhook delivery jobs successfully acknowledged with HTTP 2xx                           | Incremented after database status update completes.                            |
| `eventforge_deliveries_failed_total`       | Counter   | `error_code`, `retryable`              | Webhook delivery attempts that resulted in errors                                       | Separates transient retries from terminal dead-letters.                        |
| `eventforge_deliveries_retries_total`      | Counter   | `attempt_number`                       | Delivery jobs re-enqueued into BullMQ for backoff retries                               | Tracks scheduled retry volume by attempt sequence.                             |
| `eventforge_deliveries_dead_letter_total`  | Counter   | `reason`                               | Deliveries permanently failed and transitioned to `DEAD_LETTER`                         | Triggered by exhaustion (`max_attempts_exceeded`), 4xx errors, or SSRF blocks. |
| `eventforge_webhook_duration_seconds`      | Histogram | _none_                                 | Outbound webhook HTTP round-trip latency in seconds                                     | Measures client connection, TLS handshake, transmission, and response time.    |
| `eventforge_deliveries_in_flight_gauge`    | Gauge     | _none_                                 | Deliveries currently claimed and active in worker memory                                | Node-local process gauge. Sum across worker instances for cluster-wide count.  |
| `eventforge_queue_waiting_jobs_gauge`      | Gauge     | _none_                                 | Jobs waiting in BullMQ Redis queue to be claimed                                        | Scraped dynamically from Redis.                                                |
| `eventforge_queue_active_jobs_gauge`       | Gauge     | _none_                                 | Jobs currently claimed by BullMQ workers                                                | Scraped dynamically from Redis.                                                |
| `eventforge_queue_delayed_jobs_gauge`      | Gauge     | _none_                                 | Retry jobs delayed in BullMQ waiting for backoff timers                                 | Scraped dynamically from Redis.                                                |
| `eventforge_queue_failed_jobs_gauge`       | Gauge     | _none_                                 | Jobs marked failed inside BullMQ                                                        | Scraped dynamically from Redis.                                                |
| `eventforge_outbox_pending_gauge`          | Gauge     | _none_                                 | Outbox records in PostgreSQL waiting to be claimed                                      | Sampled at scrape time via `SELECT count(*) WHERE status = 'PENDING'`.         |
| `eventforge_outbox_failed_gauge`           | Gauge     | _none_                                 | Outbox records in PostgreSQL in `FAILED` status                                         | Sampled at scrape time via `SELECT count(*) WHERE status = 'FAILED'`.          |
| `eventforge_db_pool_total_connections`     | Gauge     | _none_                                 | Total PostgreSQL pool connections allocated                                             | Pool state at scrape time.                                                     |
| `eventforge_db_pool_idle_connections`      | Gauge     | _none_                                 | Idle PostgreSQL pool connections ready for queries                                      | Pool state at scrape time.                                                     |
| `eventforge_db_pool_waiting_requests`      | Gauge     | _none_                                 | Client requests waiting for an available PostgreSQL connection                          | Non-zero values indicate pool saturation.                                      |

> [!IMPORTANT]
> **Strict Bounded Cardinality**
> Under no circumstances are high-cardinality values (such as `event_id`, `delivery_id`, `project_id`, or `destination_url`) permitted as metric labels. All labels use bounded enumerations (e.g., `status_code_class`, `event_type`, `error_code`).

---

## 2. Structured JSON Logging

All log lines across API and Worker runtimes are formatted as single-line deterministic JSON objects.

### Schema Fields

| Field            | Type              | Description                                                   |
| :--------------- | :---------------- | :------------------------------------------------------------ |
| `timestamp`      | ISO-8601 string   | UTC timestamp of log event                                    |
| `level`          | string            | Severity: `DEBUG`, `INFO`, `WARN`, `ERROR`                    |
| `service`        | string            | Service name: `eventforge-api` or `eventforge-worker`         |
| `environment`    | string            | `production`, `development`, or `test`                        |
| `context`        | string            | NestJS class or service component name                        |
| `message`        | string            | Human-readable event description                              |
| `correlationId`  | string (optional) | Request UUID passed in `X-Request-Id` or generated upon entry |
| `projectId`      | string (optional) | Tenant project identifier                                     |
| `eventId`        | string (optional) | Business event identifier                                     |
| `deliveryId`     | string (optional) | Delivery job identifier                                       |
| `subscriptionId` | string (optional) | Target subscription identifier                                |
| `statusCode`     | number (optional) | HTTP status code                                              |
| `durationMs`     | number (optional) | Operation duration in milliseconds                            |
| `errorCode`      | string (optional) | Standardized error code                                       |

### Automated Credential Redaction

The logging system recursively scans all logged data before serialization. Any key matching `/^(x[_-]?api[_-]?key|api[_-]?key|key|secret|signing[_-]?secret|authorization|password|token|bearer)$/i` or values formatted as API keys (`ef_live_...`, `ef_test_...`) or bearer tokens are replaced with `[REDACTED]`.

Payload bodies are **never** logged in full; only metadata, sizes, and identifiers are recorded.

---

## 3. Health & Readiness Probes

### API Health Probes (`http://localhost:3000`)

- **Liveness (`GET /v1/health` and `GET /health`)**:
  Returns `200 OK` if the Node.js event loop is responsive.
  ```json
  {
    "status": "ok",
    "uptime": 128.45,
    "timestamp": "2026-10-26T09:40:00.000Z"
  }
  ```
- **Readiness (`GET /v1/ready` and `GET /ready`)**:
  Verifies database connectivity via `SELECT 1` and Redis ping. Returns `200` if both are healthy; returns `503 Service Unavailable` if either dependency is unhealthy.
  ```json
  {
    "status": "ready",
    "timestamp": "2026-10-26T09:40:00.000Z",
    "dependencies": {
      "postgres": { "status": "up", "latencyMs": 2 },
      "redis": { "status": "up", "latencyMs": 1 }
    }
  }
  ```

### Worker Health Probes (`http://localhost:3001`)

- **Liveness (`GET /v1/health` and `GET /health`)**:
  Returns `200 OK` with worker process uptime.
- **Readiness (`GET /v1/ready` and `GET /ready`)**:
  Verifies worker PostgreSQL connection pool and Redis connection state (`status === 'ready'`). Returns `200` if operational; `503` if degraded.
