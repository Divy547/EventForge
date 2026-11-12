# EventForge

EventForge is a webhook delivery service. An application sends one event to the API, and EventForge delivers it to
every subscribed endpoint: signed, retried with backoff, dead-lettered when it keeps failing, and replayable from a
dashboard. Built with NestJS, PostgreSQL, Redis (BullMQ) and a React dashboard.

## Live demo

**https://40-81-24-8.sslip.io/dashboard/**: open it and click **Try the live sandbox**. You get a one-hour key, send an
event to a built-in demo receiver, and watch it succeed, retry, dead-letter and replay. No account needed. The
interactive API reference is at [`/docs`](https://40-81-24-8.sslip.io/docs).

It runs on one small Azure for Students VM (1 GiB RAM) and every visitor shares one sandbox project, so you may see other
people's events. The VM runs on a student credit that lasts a few months; if the link is down, run it locally below.

## How it works

```text
 your app ──POST /v1/events──▶ API ──one transaction──▶ PostgreSQL: event + outbox row
                                                              │
                          worker polls outbox (FOR UPDATE SKIP LOCKED)
                                                              ▼
                          one delivery per matching subscription ──▶ BullMQ (Redis)
                                                              │
                          signed HTTPS POST to the subscriber's endpoint
                                │ success                     │ failure
                                ▼                             ▼
                            COMPLETED        retry with backoff ─▶ DEAD_LETTER ─▶ replay
```

The API and the worker are separate processes. Accepting an event needs only PostgreSQL, so the API keeps accepting events while the
worker is down; the worker catches up when it returns.

## Features

- Event ingestion with idempotency keys, per-project API keys, and rate limits (per key and per IP).
- Subscriptions with event-type patterns (`order.*`), HMAC-signed payloads, and an optional per-subscription rate limit.
- Retries with exponential backoff and jitter, a dead-letter state, and single or batch replay.
- SSRF protection on subscription URLs and again when connecting.
- `@eventforge/sdk` for receivers: signature verification with timestamp tolerance, plus an in-memory deduplication store.
- Web dashboard served by the API at `/dashboard`: delivery health, events and deliveries with every attempt, subscriptions,
  dead-letter replay, light and dark theme.
- Prometheus metrics, structured JSON logs with secret redaction, a data-retention job, and an admin CLI for projects and keys.
- Docker images built and published by CI, with automatic deploy to the demo VM after a green run.

## Design decisions

**Transactional outbox instead of publishing directly.** The API writes the event and an outbox row in one PostgreSQL
transaction (`insertEventWithOutbox`). Publishing to a queue from the request handler would be a dual write: a crash
between the two writes loses the event or sends a phantom. With the outbox, an accepted event is always durable, and the
worker turns it into deliveries afterwards. The cost is latency: delivery starts at the next poll (about 1 s).

**Idempotent ingestion in the database.** A client-supplied `idempotencyKey` is enforced with
`INSERT ... ON CONFLICT (project_id, idempotency_key) DO NOTHING`, so concurrent retries of the same request cannot create
two events, and the loser gets the existing event back with `202`. There is no check-then-insert race to get wrong.

**`FOR UPDATE SKIP LOCKED` to claim work.** Workers claim outbox rows with one `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP
LOCKED)` statement, so several workers can run without blocking each other or claiming the same row.

**At-least-once delivery, not exactly-once.** A worker can send a webhook and die before recording the result, and the
delivery is then retried. Exactly-once over HTTP is not achievable, so the contract is: a delivery is retried until the
receiver returns a `2xx` or the delivery is dead-lettered, so a successful delivery may arrive more than once. Receivers
deduplicate on the event or delivery ID (sent as `X-EventForge-Event-Id` and `X-EventForge-Delivery-Id`; the SDK has a
helper for it).

**Lease-based crash recovery.** A worker claims a delivery by moving it to `IN_FLIGHT`. A recovery job (every 30 s by
default) finds `IN_FLIGHT` deliveries older than the lease (60 s by default), records a `WORKER_CRASHED` attempt, and
makes them eligible again. This is what makes the at-least-once guarantee hold through a crash.

**Retry classification and backoff.** Retried: 5xx, 429, timeouts and connection errors. Not retried (straight to
`DEAD_LETTER`): other 4xx, and blocked or invalid URLs. The delay is `random(0, min(24h, 1s × 2^(attempt-1)))` (full
jitter, so retries from many failures do not arrive in lockstep), or the `Retry-After` header when the endpoint sends
one. The default is 5 attempts per delivery, which means four waits of at most 1, 2, 4 and 8 s: the whole retry budget is
about 15 s, so an endpoint that is down for minutes ends in `DEAD_LETTER` and needs a replay (replay grants more
attempts). Only a `Retry-After` header stretches a wait beyond that.

**HMAC signatures with a timestamp.** Each delivery carries `X-EventForge-Signature: t=<unix>,v1=<hex>`, where the value
is HMAC-SHA256 over `<timestamp>.<raw body>` with the subscription's secret. The timestamp lets receivers reject replayed
requests; the SDK compares in constant time. The signing secret is shown once, when the subscription is created.

**SSRF defence at two points.** Subscription URLs are validated when created (`apps/api/src/common/utils/ssrf-validator.ts`).
At delivery time the worker resolves DNS with a custom lookup that rejects private and reserved addresses, and checks the
address of the connected socket again, so a hostname that resolves to a public IP at validation and a private IP later
(DNS rebinding) is still blocked.

**Known limit: fan-out rate.** One worker turns outbox rows into deliveries serially, at about 6-7 ms per record, and
claims 50 per poll (it keeps polling while batches come back full). Ingestion is faster than that, so a sustained burst
builds a backlog and delivery latency grows; nothing is lost. More workers or a larger `OUTBOX_BATCH_SIZE` raise the
ceiling. Details in [`docs/architecture.md`](docs/architecture.md).

## Performance

Measured with `pnpm load-test` on a development laptop (Intel i5-12450HX, 6 CPUs visible to WSL2, 6.9 GB RAM, Node 24),
with the API, worker, PostgreSQL and Redis all on the same machine and default settings. Ranges are min-max over seven
runs. **These are local numbers, not numbers for the live demo VM**, which is far smaller.

| What                                                                | Result                                        |
| :------------------------------------------------------------------ | :-------------------------------------------- |
| Event ingestion, sequential (50 requests)                           | 147-159 req/s, p50 5.5-5.8 ms, p99 23-30 ms   |
| Event ingestion, 20 concurrent clients (200 requests)               | 441-544 req/s, p50 32-35 ms, p99 96-181 ms    |
| 50 parallel requests with the same idempotency key                  | 50 of 50 accepted, 0 constraint violations    |
| 50-event burst delivered while 300 earlier events were still queued | 0.8 s until the last webhook arrived (3 runs) |
| Endpoint fails once, then recovers                                  | delivered on the second attempt in 1.0-1.8 s  |

The 200-request run lasts under half a second, so its tail percentiles come from a small sample. Delivery latency here is
mostly the wait for the next poll tick, not webhook throughput. The test suite has 208 unit and 93 integration tests
(real PostgreSQL and Redis), run in CI.

## Run it locally

Needs Node 24+, pnpm 11+ and Docker.

```bash
cp .env.example .env
pnpm install
pnpm docker:up                 # PostgreSQL and Redis
pnpm db:migrate && pnpm db:seed
pnpm build                     # the API serves the built dashboard
pnpm dev:api                   # terminal 1, port 3000
pnpm dev:worker                # terminal 2, port 3001
pnpm demo                      # sends events through the whole pipeline and prints each step
```

Then open http://localhost:3000/dashboard/ and sign in with the API key that `pnpm db:seed` printed (project `default`).
More keys: `pnpm admin key:create --project default --name <name>`. The dashboard keeps the key in the browser's session
storage and sends it as `X-API-Key`.

To enable the sandbox button locally, set `SANDBOX_ENABLED=true` and `SANDBOX_RECEIVER_URL` (see `.env.example`).

## Using the API

Send an event and register a webhook (full reference in Swagger at `/docs`):

```bash
curl -X POST http://localhost:3000/v1/subscriptions \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{ "name": "Orders", "targetUrl": "https://example.com/webhooks", "eventTypes": ["order.*"] }'
# the response contains "signingSecret" (shown once; save it)

curl -X POST http://localhost:3000/v1/events \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" \
  -d '{ "eventType": "order.completed", "source": "checkout", "payload": { "orderId": "ord_1001" },
        "idempotencyKey": "order-1001" }'
# HTTP 202 Accepted
```

Verify a delivery in your receiver with the SDK (the raw request body must be passed unparsed):

```typescript
import { EventForgeWebhook } from '@eventforge/sdk';

const webhook = new EventForgeWebhook({ toleranceSeconds: 300 });

// throws WebhookVerificationError if the signature or timestamp is invalid
const event = webhook.constructEvent(rawBody, req.headers, process.env.WEBHOOK_SECRET!);
```

## Development

| Command                       | What it does                                                         |
| :---------------------------- | :------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint` | Type check and lint every package                                    |
| `pnpm test:unit`              | Unit tests                                                           |
| `pnpm test:integration`       | Integration tests against real PostgreSQL and Redis                  |
| `pnpm load-test`              | The five load scenarios above (needs `pnpm docker:up`)               |
| `pnpm smoke-test`             | End-to-end check that starts the built API and worker                |
| `pnpm smoke-test:remote`      | HTTP-only check of a running stack (set `API_URL`)                   |
| `pnpm admin <cmd>`            | Projects and keys: `project:create`, `key:create/list/revoke/rotate` |

```text
apps/api         NestJS REST API (ingestion, auth, stats, replay, sandbox, Swagger)
apps/worker      NestJS worker (outbox poller, BullMQ delivery, retries, retention)
apps/dashboard   React + Vite dashboard, served by the API at /dashboard
packages/        common (crypto, SSRF, tracing), config, database (Drizzle), sdk
```

## More documentation

- [What is EventForge? (plain English)](docs/README.md)
- [Architecture and delivery semantics](docs/architecture.md)
- [Deployment and operations](docs/deployment.md), [Azure for Students guide](docs/deploy-azure-student.md), [local fallback behind a tunnel](docs/deploy-fallback.md)
- [Metrics, logging and observability](docs/observability.md)
