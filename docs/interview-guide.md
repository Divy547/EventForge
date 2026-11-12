# EventForge — Interview Guide

A study guide for explaining EventForge without notes. Every statement below was checked against the code on
2026-11-12; file paths are given so you can open the code while you practise. Where something is a limit or a gap,
it says so, because an interviewer who finds a gap you did not mention will trust the rest less.

**How to use it.** Read a section, close the file, and say the answer out loud. Then open the code pointer and check
yourself. Section 14 is a checklist you can tick off.

---

## 1. The 60-second pitch

> EventForge is a webhook delivery service. A client posts an event to the API; the API writes the event and an
> "outbox" row in one PostgreSQL transaction and answers `202`. A separate worker claims outbox rows, works out which
> subscriptions match the event type, creates one delivery row per subscription, and pushes jobs to a BullMQ queue.
> Job handlers send a signed HTTP POST to the customer's endpoint, retry transient failures with jittered exponential
> backoff, and dead-letter anything that cannot succeed, from where it can be replayed. State lives in PostgreSQL, so a
> crashed worker or a wiped Redis does not lose work. Delivery is at-least-once, so receivers must deduplicate. There is
> a React dashboard, a public sandbox, and a live instance on a small Azure VM.

Why it exists: when you call someone else's HTTP endpoint you cannot assume it is up, fast or honest, and you cannot
assume your own process survives the call. The project is about the failure handling around that call.

## 2. One event, end to end

Say this as a story; it is the spine every other answer hangs from.

1. `POST /v1/events` passes the rate limiter, then the API-key guard (`apps/api/src/common/guards`).
2. `EventsService.ingestEvent` rejects payloads over 256 KB and calls `insertEventWithOutbox`
   (`packages/database/src/transactions/outbox.ts`): one transaction inserts the `events` row and an `outbox_records`
   row (`PENDING`). Then `202`.
3. Every second the worker's `OutboxPollerService` claims up to 50 outbox rows with `FOR UPDATE SKIP LOCKED`.
4. For each row it loads the event, finds the project's active subscriptions whose patterns match (`*`, exact, or
   `order.*`), inserts `deliveries` rows (`ON CONFLICT DO NOTHING`), adds a BullMQ job per delivery, then marks the
   outbox row `PROCESSED`.
5. `DeliveryProcessor` takes the job, applies the per-subscription rate limit, claims the delivery with a conditional
   `UPDATE` (`PENDING`/due `FAILED` to `IN_FLIGHT`), builds the envelope, signs it, and POSTs it through
   `HttpDispatcherService`.
6. A `2xx` marks the delivery `COMPLETED`. Anything else is classified: retry with backoff (`FAILED` plus a delayed
   job) or `DEAD_LETTER`. Every attempt is written to `delivery_attempts`.
7. If a worker dies mid-attempt, or Redis loses the job, `StaleDeliveryRecoveryService` repairs it from PostgreSQL.

## 3. Transactional outbox

**What problem.** Saving an event and publishing it to a queue are two writes to two systems. If the process dies
between them you either lose the event (saved nowhere) or announce an event that was never saved. The outbox turns the
two writes into one: the event and the "please publish this" record commit together, and a separate process does the
publishing from the database.

**Here.** `insertEventWithOutbox` wraps both inserts in `db.transaction`. Redis is never touched on the request path,
so ingestion keeps working while Redis is down.

**Likely questions**

- _Why not publish to Redis inside the request?_ Dual write: a crash between the DB commit and the Redis add loses the
  event, and the reverse order publishes ghosts.
- _Why not Kafka or CDC (Debezium)?_ Extra infrastructure for a project with a 1 GiB host and a zero budget. Polling is
  simple and good enough; the cost is up to about one poll interval of latency (1 s by default).
- _What if the worker crashes after enqueuing but before marking the outbox row done?_ The row stays `PROCESSING` and is
  reclaimed after a fixed 5 minutes. Fan-out runs again, and is safe: `deliveries` has a unique index on
  `(event_id, subscription_id)` so the inserts are no-ops, and a duplicate job cannot double-send because the claim in
  section 7 refuses a delivery that is `COMPLETED`, `DEAD_LETTER` or already `IN_FLIGHT`.

**Own this limit.** A crashed claim means a delay of at least 5 minutes for those events (`claimTimeoutMinutes` is a
hard-coded 5 in `outbox-poller.service.ts`; the plan records that wiring it to config would have changed behaviour).

## 4. Idempotent ingestion (`ON CONFLICT`)

**What.** A client may send `idempotencyKey`. The `events` table has a unique index on `(project_id, idempotency_key)`.
The insert is `ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING`. If it returns a row this request won;
if not, the code selects the existing event and its outbox row and returns them with `isDuplicate: true`.

**Why not "select, then insert if missing".** Two concurrent requests can both see "missing" and both insert. The unique
index makes the database the arbiter, with no application lock. Under a conflict, the second inserter waits for the
first transaction to finish, then does nothing, so the follow-up select finds a committed row.

**Evidence.** `apps/api/test/events.concurrency.integration.spec.ts`; the load test sends 50 parallel requests with the
same key and gets 50 of 50 accepted with 0 constraint violations, in every one of seven runs.

**Details worth knowing**

- Events without a key are never deduplicated. In PostgreSQL, `NULL`s are distinct in a unique index, so they do not
  collide.
- The key is scoped to the project, so two tenants can use the same key.
- A duplicate returns the **original** event. The payload of the second request is not compared, so a reused key with a
  different body silently returns the first event. That is the usual semantics (Stripe behaves the same way), but know it.
- Both the response and the metric mark the duplicate (`eventforge_events_accepted_total{is_duplicate}`).

## 5. `FOR UPDATE SKIP LOCKED` and outbox claiming

**What.** `claimPendingOutboxRecords` runs one statement: a CTE selects candidate ids with `FOR UPDATE SKIP LOCKED`, and
the outer `UPDATE ... RETURNING` flips them to `PROCESSING`, stamps `claimed_by`/`claimed_at`, and increments
`attempts`. Candidates are `PENDING`, or `PROCESSING` older than 5 minutes, or `FAILED` (under 10 attempts) older than
5 minutes. Ordered by `created_at`, limited to the batch size.

**Why `SKIP LOCKED`.** With several workers, a plain `FOR UPDATE` makes the second worker wait on the first one's rows.
`SKIP LOCKED` makes it skip locked rows and take the next free ones, so workers share the queue without blocking and
without ever holding the same row.

**Likely questions**

- _Is anything lost when rows are skipped?_ No. A skipped row is locked by a worker that is handling it right now. If
  that worker dies, the lock is released and the lease rule makes the row claimable again.
- _What is the trade-off?_ A queue read with `SKIP LOCKED` gives no strict global ordering across workers (ordering is
  best-effort by `created_at` within a batch). Webhooks here do not promise ordering; say so.
- _Why not `SELECT` then `UPDATE`?_ Not atomic; two workers could pick the same row. Doing it in one statement is the
  point.
- _How does it behave under a backlog?_ The poller loops while batches come back full (up to 20 batches per tick), which
  is the Phase 4 worker fix (`e0f9600`). Before that, one batch per tick capped fan-out at about 50 events/s.

## 6. Fan-out and the delivery table

An event becomes N `deliveries` rows, one per matching active subscription, each with its own status, attempt count
and `max_attempts` (5). This is the reason retries and dead letters are per subscription: one slow customer endpoint
does not affect another's state.

`matchesEventType` (`packages/common/src/utils.ts`) supports `*`, an exact name, and `prefix.*`. Note `order.*`
matches `order.created` and also `order.item.added` (it is a string prefix match), but not `order` itself.

Own this limit: fan-out is serial per record (about 6-7 ms each on the local stack), so one worker handles roughly 150
events/s sustained. That figure is derived from the per-record time, **not** measured end to end.

## 7. Delivery state machine and claiming

States: `PENDING`, `IN_FLIGHT`, `COMPLETED`, `FAILED`, `DEAD_LETTER` (diagram in `docs/architecture.md` section 3).

`claimDeliveryForProcessing` is the key function. In one transaction it first moves an exhausted delivery to
`DEAD_LETTER`, then does a conditional `UPDATE ... WHERE` that only matches if the row is `PENDING`, or `FAILED` with
`next_retry_at` due, or `IN_FLIGHT` with a stale `updated_at`. If the `UPDATE` returns no row, someone else has it or it
is not due, and the job simply returns.

**Why this matters.** BullMQ can deliver the same job twice and recovery can enqueue a job that already exists. The
conditional `UPDATE` makes duplicate jobs harmless: only one can win the transition. State changes are done in the
database, not in memory, so any worker can take over.

**Likely question: _why keep delivery state in PostgreSQL when BullMQ already tracks jobs?_** Redis is volatile and its
job state is not queryable per tenant. PostgreSQL gives durable state, the audit trail, joins for the dashboard, and
the ability to rebuild the queue. The test `recovers retries from PostgreSQL following total Redis job loss`
(`apps/worker/test/reliability-remediation.integration.spec.ts`) covers the rebuild case. Redis here only schedules
(delays, concurrency).

## 8. At-least-once delivery and consumer idempotency

**The guarantee.** A delivery is retried until the receiver answers `2xx` or the delivery is dead-lettered. It is
**at-least-once**, not exactly-once.

**Why not exactly-once.** The receiver can process the request and the response can still be lost (timeout, reset). The
sender cannot tell "never arrived" from "arrived, ack lost", so the only safe choice is to send again. A second source of
duplicates is a worker crashing after the receiver answered but before `recordSuccessfulDelivery` committed: the lease
expires and the delivery is re-sent. Exactly-once effects are built on the receiver side by deduplicating.

**Receiver side.** Each request carries the event id in the body (`id`) and `X-EventForge-Event-Id`, and a per-delivery
id in `X-EventForge-Delivery-Id`. The delivery id is stable across retries of one delivery. If one event matches two
subscriptions that point at the same consumer, the event id is the same in both, so choose the dedupe key
accordingly. The SDK ships `MemoryIdempotencyStore` (single process); a real consumer would use a database unique
constraint or Redis `SET NX`.

## 9. Lease-based crash recovery

**Lease.** There is no lease column. A delivery that is `IN_FLIGHT` with `updated_at` older than the lease is considered
abandoned. The lease is `max(DELIVERY_LEASE_TIMEOUT_MS, WEBHOOK_TIMEOUT_MS + 30 s)`
(`apps/worker/src/config/worker-config.service.ts`), so it can never be shorter than a request is allowed to run. With
defaults it is 60 s against a 10 s request timeout.

**Recovery pass** (`StaleDeliveryRecoveryService`, every 30 s by default) does two things:

1. Abandoned `IN_FLIGHT` rows: inserts a synthetic attempt with `error_code = WORKER_CRASHED`, increments the attempt
   count, and sets `FAILED` (retry now) or `DEAD_LETTER` if that was the last attempt.
2. Due `FAILED` or `PENDING` rows untouched for 30 s: re-enqueues a BullMQ job with the deterministic id
   `delivery-<id>-<attempt>` and touches `updated_at` so the next pass does not enqueue it again. This is the backstop
   when Redis lost the job (restart without persistence, eviction, outage while retrying).

**Likely questions**

- _What is the cost of the lease?_ A crashed worker's delivery waits up to the lease length (60 s) before it is retried.
  Too short a lease risks a slow-but-alive worker being overtaken, so the lease is kept well above the request timeout.
- _Why deterministic job ids?_ BullMQ ignores an `add` whose id already exists, so repeated enqueues of the same
  attempt do not multiply jobs.

**Own this limit (found while reading, not reproduced).** `recoverAbandonedInFlightDeliveries` selects abandoned rows
and then updates each by id with no status guard in the `UPDATE`. With one worker, an `isRecovering` flag prevents
overlap. With two workers running the pass at the same moment, both could record a `WORKER_CRASHED` attempt for the same
row and increment the count twice. The docs already say multiple replicas have not been load-tested. The fix would be a
conditional update (`WHERE status = 'IN_FLIGHT' AND updated_at < ...`) or `SKIP LOCKED` on the select. Being able to
name this is a strength; do not claim the recovery pass is multi-replica safe.

## 10. Retry classification and backoff

Code: `DeliveryProcessor.handleDeliveryError` and `calculateExponentialBackoff`.

| Outcome                                                                                      | Treated as                           |
| :------------------------------------------------------------------------------------------- | :----------------------------------- |
| `2xx`                                                                                        | success                              |
| `429`, any `5xx`                                                                             | retryable                            |
| timeout, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, generic network error       | retryable                            |
| other `4xx`, any `3xx`, `SSRF_BLOCKED`, `INVALID_URL`, `UNSUPPORTED_PROTOCOL`, anything else | permanent: straight to `DEAD_LETTER` |
| attempt number reaches `max_attempts`                                                        | `DEAD_LETTER` whatever the error was |

**Why classify.** Retrying a `400` or `404` can never help and only adds load; retrying a `503` or a timeout usually
does. `429` is retryable because it asks you to slow down.

**Backoff.** Full jitter: `random(0, min(24 h, 1 s x 2^(attempt-1)))`. Jitter matters because a receiver that was down
makes many deliveries fail at once; without it they all retry at the same instant and knock it over again (thundering
herd). A `Retry-After` header (seconds or HTTP date) replaces the computed delay, clamped to 1 s to 24 h.

**Redirects are not followed.** Node's `http.request` does not follow them, so a `3xx` becomes a non-retryable failure.
That also closes redirect-based SSRF.

**Own this limit: the default retry budget is about 15 seconds.** Five attempts leave four waits with ceilings of 1, 2,
4 and 8 s, about 7 s on average. A receiver that is down for minutes dead-letters its deliveries and needs a replay.
Real products stretch retries over hours or days. The honest answer is that the delays and attempts are defaults, a
product decision that has not been made (the plan records it as open), and that replay exists for this case.

## 11. Dead letters and replay

A delivery that cannot succeed stays in the table as `DEAD_LETTER` with its full attempt history. Replay
(`POST /v1/deliveries/:id/replay`, and a batch variant) in `replayDeadLetterDelivery`:

1. Takes a row lock (`FOR UPDATE`) scoped to the project, so one tenant cannot replay another's delivery.
2. Refuses anything not `DEAD_LETTER` (`409`).
3. Sets `PENDING`, sets `max_attempts = attempts_count + additional` (default 3, clamped to 1-10), keeps the attempt
   history.
4. The API then enqueues a BullMQ job. If Redis is down, the replay still succeeded in PostgreSQL and the recovery pass
   picks up the `PENDING` row.

Why add headroom instead of resetting the counter: the history stays truthful, and a delivery that keeps failing
cannot loop forever.

Own this limit: batch replay is capped at 50 per call, and the dashboard has no "replay all" button.

## 12. Security

### HMAC signing and verification

Header: `X-EventForge-Signature: t=<unix seconds>,v1=<hex>`, where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`
(`signWebhookPayload` in `packages/common/src/crypto.ts`). The timestamp is regenerated on every attempt.

Verification (`packages/sdk/src/signature.ts`):

1. Parse `t` and `v1`; reject malformed headers.
2. Reject if the timestamp is older than the tolerance (300 s) or more than 5 s in the future. This limits replay.
3. Recompute the HMAC over `t.body` and compare with `timingSafeEqual` (constant-time, so response time does not leak
   how many leading characters matched).

**Likely questions**

- _Why include the timestamp in the signed string?_ So an attacker cannot capture a valid request and replay it later,
  and cannot change the timestamp without breaking the signature.
- _Why the raw body?_ The HMAC is over exact bytes; re-serialising parsed JSON changes whitespace and key order.
- _Does the timestamp stop replay completely?_ No, it bounds it to the tolerance window. A receiver that wants to be
  strict also deduplicates on event id.
- _Where is the secret kept?_ Shown once at creation and not returned afterwards. In the database it is stored as-is,
  because the worker needs the plaintext to sign; encrypting it at rest would need a key that the worker also holds.
  Say that plainly.

### API keys

Generated from 24 random bytes (`generateApiKey`), shown once, stored as a SHA-256 hash (unique index on `hashed_key`).
`ApiKeyGuard` hashes the presented key, looks it up joined to its project, and rejects revoked or expired keys.
Why SHA-256 and not bcrypt: the key already has 192 bits of randomness, so there is nothing to brute-force and a slow
hash adds latency on every request for no benefit; bcrypt exists to protect low-entropy passwords. Rotation is atomic
(`key:rotate` revokes the old key and creates the new one). All queries are filtered by the key's project id, which is
the tenant isolation.

### Rate limiting (API)

`RateLimitGuard`: Redis `INCR` + `PEXPIRE ... NX` per window, two buckets (client IP, and the key's hash). The IP bucket
also throttles key guessing because the guard runs before authentication. Defaults 2400/IP and 1200/key per 60 s.
Own these limits: fixed windows allow up to about twice the limit across a window boundary (a sliding window or token
bucket would be smoother), and it **fails open** when Redis is down, by design, to keep ingestion available. Behind a
reverse proxy, `TRUST_PROXY_HOPS` must be set or every request looks like it comes from the proxy.

### SSRF protection

The risk: a user supplies a webhook URL and your server makes the request, so they can aim it at your internal network
or the cloud metadata service (`169.254.169.254`).

Two points of defence:

1. **At subscription creation or update** (`subscriptions.service.ts`): `validateDestinationUrl` checks the protocol
   (http/https only), rejects credentials in the URL, rejects known metadata hosts, resolves DNS and rejects any
   private, loopback or link-local address.
2. **At send time** (`http-dispatcher.service.ts`), because DNS can change after validation (DNS rebinding: a name that
   resolves to a public IP at creation and a private one later). The dispatcher installs a custom `lookup` that
   validates every address it resolves, and checks the connected socket's remote address again. Because the check is
   done on the address actually used to connect, there is no gap to exploit. Redirects are not followed.

Both checks are skipped only when `ALLOW_LOCAL_WEBHOOKS` is set (refused by config validation in production) or for the
exact sandbox receiver URL.

**Own these limits (verified by running `isPrivateIp`, 2026-11-12).** The block list is hand-written. It does not cover
`100.64.0.0/10` (carrier-grade NAT), and the IPv6 check is prefix-based, so `::ffff:7f00:1` (hex form of an
IPv4-mapped loopback) and `0:0:0:0:0:0:0:1` (uncompressed loopback) return `false`. I did not test whether the
resolver or socket can actually present those forms; Node normally reports IPv4-mapped addresses in dotted form. The
fix would be to parse addresses with a library or `net.BlockList` instead of string prefixes. Mentioning this shows you
understand the control, not just that it exists.

## 13. Remaining components, briefly

**Per-subscription rate limit (`rateLimitPerSecond`).** `SubscriptionThrottleService` runs a Lua script in Redis that
implements GCRA-style slot scheduling: each caller atomically gets the next free time slot, using Redis `TIME` so all
workers share one clock. If the slot is in the future, the job is re-enqueued with that delay and a `throttleReserved`
flag, **before** the delivery is claimed, so throttling never consumes an attempt or changes delivery state. Lua because
read-compute-write must be atomic across workers. Fails open if Redis is down. Limit: a large backlog for a slow
subscription becomes many delayed BullMQ jobs.

**Retention.** `purgeExpiredRecords`, hourly, 30 days by default. Deletes only `COMPLETED` deliveries past the window,
then events past the window that have no deliveries left and a `PROCESSED` outbox row. Never deletes unfinished work or
dead letters, which an operator may still want to replay. Batched with `SKIP LOCKED` to keep locks short.

**Observability.** Prometheus-format metrics at `/metrics` (token-protected in production), structured JSON logs with
correlation ids, and W3C `traceparent` propagated from the inbound request to the outbound webhook. It propagates only:
no spans are exported, so say "context propagation", not "distributed tracing".

**Sandbox (public demo).** `POST` creates a visitor session: a one-hour key (`SANDBOX_KEY_TTL_MS`) for one shared demo
project. `SandboxQuotaGuard` stops that key from creating subscriptions and limits writes per IP per hour, so the demo
cannot be used as a free webhook sender. Subscriptions point at a receiver inside the API, and only that exact URL is
exempt from SSRF blocking. First-time project creation is serialised with a PostgreSQL advisory lock. Everyone shares one
project, so visitors see each other's events (a known limit).

**Dashboard.** React + Vite single-page app served by the API at `/dashboard`; the key is pasted and kept in
`sessionStorage`, sent as `X-API-Key`. 95 unit tests (Vitest). Shows stats, events, deliveries, subscriptions, dead
letters with replay.

**Deployment.** One Azure for Students VM (2 vCPU, 1 GiB) running Docker Compose behind Caddy (automatic Let's
Encrypt certificate on `<ip>.sslip.io`). CI builds the images and pushes them to GHCR; the VM only pulls, because 1 GiB
cannot build. A green CI run on `main` deploys over SSH. A failed deploy is not rolled back. Credit lasts about 6
months; the local-plus-tunnel fallback is documented in `docs/deploy-fallback.md`.

## 14. Self-test checklist

You are ready when you can do each of these aloud, in under two minutes, without notes.

- [ ] Draw the pipeline and walk one event through it (section 2).
- [ ] Explain the dual-write problem and how the outbox solves it (3).
- [ ] Explain why `ON CONFLICT` beats select-then-insert, and what happens to NULL keys (4).
- [ ] Explain `SKIP LOCKED` and what a single-statement claim buys you (5).
- [ ] Explain why delivery is at-least-once, give both sources of duplicates, and say what the consumer must do (8).
- [ ] Explain the lease, the `WORKER_CRASHED` attempt, and the Redis-loss backstop (9).
- [ ] List what is retried, what is not, and why full jitter (10).
- [ ] Explain replay and why attempt history is kept (11).
- [ ] Explain what the signature covers, why the timestamp is signed, and why `timingSafeEqual` (12).
- [ ] Explain DNS rebinding and why SSRF is checked twice (12).
- [ ] Name at least four limits unprompted (section 15).

## 15. Hard questions: limits to own

Say these before they are found.

1. **The retry budget is about 15 s.** Not enough for real outages; replay is the mitigation (10).
2. **At-least-once, not exactly-once.** By design, so receivers must deduplicate (8).
3. **Outbox claim timeout is a fixed 5 minutes.** A crash delays those events by at least that long (3).
4. **The recovery pass has an unguarded update.** Probably double-counts under two workers; untested (9).
5. **Rate limits are fixed-window and fail open.** Burst at boundaries; no limiting during a Redis outage (12).
6. **The SSRF block list is hand-written.** Misses CGNAT and some IPv6 spellings (12).
7. **Signing secrets are stored in plaintext in the database** (12).
8. **One small VM, no high availability, no rollback on a failed deploy.** Replicas were never load-tested.
9. **The benchmark is local.** Run on a laptop with the database on the same machine; not a deployed-instance number.
10. **Offset pagination.** `count(*)` plus `OFFSET` is fine at this size and degrades on deep pages; keyset pagination
    is the upgrade.
11. **No ordering guarantee** between events, and none promised.

## 16. Numbers you can quote

From the local load test (i5-12450HX, 6.9 GB RAM, Node 24, Postgres and Redis in Docker on the same machine; seven
runs, ranges are min-max):

- Sequential ingestion: 147-159 req/s, p50 about 5.5 ms.
- Concurrent ingestion (20 clients, 200 requests): 441-544 req/s, p99 96-181 ms. The run lasts under half a second, so
  tail percentiles rest on 200 requests.
- 50 parallel requests with one idempotency key: 50 of 50 accepted, 0 constraint violations, every run.
- A 50-event burst, even behind a 300-event backlog, fully delivered in 0.8 s after the drain-loop fix (was 5.4-5.8 s).
- Endpoint fails once then recovers: delivered on the second attempt in 1.0-1.8 s.
- Tests: 208 unit and 91 integration (real PostgreSQL and Redis), `smoke-test:remote` 28/28 against the live URL.

**Do not say:** "exactly-once", "zero message loss", "highly available", "handles X requests per second in
production", or quote the old "9 deliveries/s" (that was backlog, not throughput). Do not present the 62
deliveries/s the script prints as throughput; it is a latency dominated by the wait for the next poll tick.
