# EventForge — Plan Archive

> **Historical.** This file holds completed-phase details moved out of `PLAN.md` on 2026-11-12:
> the pre-Phase-1 baseline, the known gaps found during review, and the Phase 1 task notes and
> acceptance criteria. Nothing here is current work; see `PLAN.md` for status and next steps.

---

## Baseline before Phase 1 (verified 2026-11-12)

| Check                                     | Result                       |
| :---------------------------------------- | :--------------------------- |
| `pnpm typecheck`                          | ✅ Pass                      |
| `pnpm lint`                               | ✅ Clean                     |
| `pnpm format:check`                       | ✅ Clean                     |
| `pnpm test:unit`                          | ✅ 64/64 (API 40, worker 24) |
| `pnpm test:integration` (real PG + Redis) | ✅ 48/48 (API 36, worker 12) |

### Known gaps found during review

> **All eight gaps below were resolved in Phase 1** (see §4). Three further problems were found and
> fixed while verifying Phase 1: the Docker images shipped without dependencies, the prod compose
> shared a project name with the dev stack, and `.env.production` was not git-ignored.

1. **No tenant onboarding** — projects and API keys can only be created by `db:seed`; no create,
   revoke, or rotate flow.
2. **`rateLimitPerSecond` is accepted but never enforced** — stored on subscriptions, never read by
   the worker.
3. **No API abuse protection** — no request rate limiting, no `helmet`, no explicit CORS policy.
4. **Internal surfaces exposed** — API `/metrics` is public; `docker-compose.prod.yml` publishes
   worker port 3001; Postgres password silently falls back to a hard-coded default.
5. **No TLS** — production compose serves plain HTTP on port 3000.
6. **No data retention** — events, deliveries, and attempts grow without bound.
7. **Migrations are manual** — not part of the deploy flow.
8. **Doc drift** — `docs/architecture.md` shows the outbox claim query as `PENDING`-only (the real
   query also reclaims stale `PROCESSING` and retryable `FAILED` rows) and references a
   `lease_expires_at` column that does not exist (leases derive from `deliveries.updated_at`).
   Unverified README claims (e.g. "~77 MB images") need checking.

---

## Phase 1 — Production Hardening: tasks and acceptance criteria

**Tasks**

1. ✅ **Admin CLI** (`packages/database/src/scripts/admin.ts` or similar): create project, create API
   key, list keys, revoke key, rotate key. Raw keys printed once; only hashes stored.
   _Done: `project:create|list`, `key:create|list|revoke|rotate`. Rotation is atomic._
2. ✅ **API protection**: request rate limiting (per API key / per IP), `helmet` security headers,
   explicit CORS configuration.
   _Done: fixed-window Redis limiter checked before auth (fails open if Redis is down); `TRUST_PROXY_HOPS`
   for use behind Caddy; relaxed CSP only for `/docs`._
3. ✅ **Close internal surfaces**: make API `/metrics` private or token-protected; stop publishing the
   worker port publicly; require `POSTGRES_PASSWORD` (`${POSTGRES_PASSWORD:?}`) in prod compose.
   _Done: `METRICS_TOKEN` bearer token (404 in production when unset)._
4. ✅ **Per-subscription rate limit**: implement `rateLimitPerSecond` in the worker (Redis token bucket,
   delayed re-enqueue when throttled) **or** remove the field from schema, DTOs, and docs.
   _Done (enforced): atomic Lua slot reservation (GCRA-style), re-enqueue for the reserved slot, never
   consumes a retry attempt. Known limitation: a large backlog is held as delayed BullMQ jobs._
5. ✅ **Retention job**: periodic cleanup of completed deliveries/attempts and old events after a
   configurable number of days (`RETENTION_DAYS`).
   _Done: batched `SKIP LOCKED` deletes; events are removed only when no deliveries remain and the outbox
   record is `PROCESSED`._
6. ✅ **Automated migrations**: one-off `migrate` service in prod compose that runs before API/worker
   start.
   _Done. Verifying this exposed that the Docker images could not start at all (`pnpm prune --prod` emptied
   `node_modules`); both Dockerfiles now reinstall production dependencies._
7. ✅ **Doc corrections**: fix the drift listed in §3 and verify or remove unverified claims.
   _Done, including extra drift found (crash recovery transitions, backoff cap, env-file usage). Image size
   is now measured: ~73 MB compressed, ~369 MB on disk. "Production-grade" wording is left for Phase 4._

**Acceptance criteria**

- [x] A new project and API key can be created, listed, revoked, and rotated via a documented
      command; a revoked key receives `401`.
- [x] Exceeding the API rate limit returns `429` with a `Retry-After` header; covered by a test.
- [x] Responses include `helmet` security headers; CORS rejects disallowed origins.
- [x] From outside the Docker network, `/metrics` and the worker port are unreachable (or require a
      token).
- [x] `docker compose -f docker-compose.prod.yml up` fails fast if `POSTGRES_PASSWORD` is unset.
- [x] `rateLimitPerSecond` is either enforced (integration test shows throughput capped for a
      subscription) or fully removed — no dead fields remain.
- [x] Retention job deletes records older than `RETENTION_DAYS` and never deletes `PENDING`,
      `IN_FLIGHT`, `FAILED`, or `DEAD_LETTER` deliveries; covered by an integration test.
- [x] A fresh `docker:prod:up` on an empty database applies migrations automatically and the API
      reports ready.
- [x] `docs/architecture.md` and `README.md` match the code.
- [x] Typecheck, lint, format, unit, and integration tests all pass; `pnpm smoke-test` passes
      against the prod compose stack.
      _Interpreted per the HTTP-only decision above: `pnpm smoke-test` passes in its default mode, and
      `pnpm smoke-test:remote` (16 checks) passes against the real prod compose stack. The original
      `smoke-test` cannot target the prod stack because it needs direct DB access, a local webhook
      receiver (blocked by SSRF in production) and the now-closed worker port._
