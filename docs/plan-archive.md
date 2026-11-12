# EventForge — Plan Archive

> **Historical.** This file holds completed-phase details moved out of `PLAN.md` on 2026-11-12:
> the pre-Phase-1 baseline, the known gaps found during review, the Phase 1 task notes and
> acceptance criteria (moved 2026-11-12), the baseline after Phase 1, the Phase 2 (dashboard) task notes and
> acceptance criteria (moved after task 12), and the Phase 3 (free deployment) tasks, notes and risks (moved in Phase 3 task 8). Nothing here is current work; see `PLAN.md` for status and next steps.

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

---

## Baseline after Phase 1 (2026-11-12)

| Check                                     | Result                                         |
| :---------------------------------------- | :--------------------------------------------- |
| `pnpm typecheck`, `lint`, `format:check`  | ✅ Clean                                       |
| `pnpm test:unit`                          | ✅ 68/68 (API 41, worker 27)                   |
| `pnpm test:integration` (real PG + Redis) | ✅ 63/63 (API 48, worker 15)                   |
| `pnpm smoke-test`                         | ✅ 11/11 (spawns built API and worker locally) |
| `pnpm smoke-test:remote` (prod compose)   | ✅ 16/16                                       |

---

## Phase 2 — Dashboard: tasks and acceptance criteria

**Status: ✅ Complete (2026-11-12).** All twelve tasks are committed (hashes in `PLAN.md`); the text below is the task list with each task's completion notes.

**Existing API surface** (checked 2026-11-12): events (`POST`, `GET` list with `page`/`limit`, `GET :id`),
deliveries (`GET` list, `GET :id` which already includes the attempts list, single and batch DLQ replay),
subscriptions (full CRUD). **Missing for the dashboard:** a stats summary, and deliveries on event detail.

**Tasks** (one commit each; all quality gates green before each commit)

1. ✅ **Backend support endpoints** (`fc7dd20`): `GET /v1/stats?windowHours=` (counts by status, success
   rate = `COMPLETED / (COMPLETED + DEAD_LETTER)`, 10 most recent failures with last status code and error;
   project-scoped) and `deliveries` on `GET /v1/events/:id`. Covered by unit and integration tests including
   tenant isolation (API: 45 unit, 59 integration).
2. ✅ **Dashboard scaffold** (`43bff6a`): `apps/dashboard` (React + Vite + TypeScript) in turbo, with Tailwind, shadcn/ui
   (`components.json`, `@/` alias), Recharts through the shadcn chart component, and `motion`. Fonts are
   **bundled** (e.g. `@fontsource`), not loaded from Google Fonts, so there are no third-party requests. The API
   serves the bundle at `/dashboard`; the Dockerfile includes it. CSP is relaxed **for `/dashboard` only**
   (Radix can inject `<style>` tags, so `style-src` may need `'unsafe-inline'`; verified by test, not assumed).
   Vitest + Testing Library set up with the small jsdom polyfills Radix needs. `motion` is configured to respect
   the visitor's reduced-motion setting. Root lint, Prettier and typecheck must cover the generated shadcn files.
   _Done: Vite 8 + React 19 + Tailwind 4 (`@tailwindcss/vite`), shadcn (`components.json`, Button, Card, Chart),
   bundled variable fonts, `MotionConfig reducedMotion="user"`, Vitest + jsdom polyfills. The API serves the bundle
   (`serve-dashboard.ts`: SPA fallback, immutable hashed assets, 404 for missing files) and applies a dashboard-only
   CSP (same-origin scripts, fonts and connections; inline styles allowed; no `upgrade-insecure-requests`).
   Both Dockerfiles updated; the worker image skips the dashboard build. Note: helmet's default CSP already
   allowed inline styles, so the dashboard policy is a tightening (no `https:` wildcards), not a loosening.
   Button sizes were trimmed to keep the 44 px target. Verified in the built API image (`/dashboard/some/route` → 200)._
3. ✅ **Login / landing page** (`e82fa8c`): the page described under Design (see `docs/dashboard-design.md`). Paste an API key, kept in
   `sessionStorage` only; invalid key shows an error and no data. Includes the `motion` explainer animation.
   _Done: landing page with headline, API-key form, `motion` explainer and four feature cards. A key is
   verified against `GET /v1/stats?windowHours=1` (`X-API-Key`), stored in `sessionStorage` only (guarded against
   storage errors), and sign-out clears it; 401/429/network/other errors each get their own message. Explainer: 5 steps
   in a 16 s loop with Pause/Play; under reduced motion it is a static diagram with all captions and outcomes shown.
   Added shadcn Input and Label. 15 component tests. **Deferred to task 10:** the "Try the live sandbox" button, since the
   sandbox does not exist yet. A signed-in placeholder page stands in until task 4 (Overview)._
4. ✅ **Overview page** (`61402a4`): totals, success rate, recent failures.
   _Done: `Overview` replaces the signed-in placeholder. Window selector (1 h / 24 h / 7 d / 30 d) and refresh;
   four stat cards (events, deliveries, success rate, dead-lettered); a status bar chart (shadcn chart) with the
   same numbers as a text list beside it; recent failures with reason, attempts and relative time. Loading, error
   and empty states; a failed refresh keeps the last data; a 401 signs the visitor out. Shared `AppHeader`.
   `fetchStats` in `lib/api.ts` mirrors `StatsResponseDto`; checked against the real `/v1/stats` response on a
   local stack. 24 dashboard tests (9 new). Note: the production bundle now trips Vite's 500 kB chunk warning
   (Recharts); code-splitting is left for the polish pass (task 11)._
5. ✅ **Events pages** (`3e92e81`): paginated list with filters; event detail with its deliveries.
   _Done: routing with `react-router` (`BrowserRouter basename="/dashboard"`; deep links
   survive sign-in; unknown paths go to Overview) and a header nav. Events list: filters (event type, source, from,
   to; apply on submit) and page number live in the URL; dates become the start and end of the visitor's local day;
   malformed values are ignored. Event detail: facts, deliveries table (status, attempts of max, next retry, completed),
   payload and metadata as JSON, 404 message. New shared pieces: `getJson` and `ApiResult` in `lib/api.ts`,
   `useApiResource` hook (Overview migrated to it), shadcn-style Table, `StatusBadge`, `Pagination`. 40 dashboard tests
   (16 new). Checked against a real local API (list, paging, filters, detail, 404, 401, `/dashboard/events/<id>` → 200).
   Notes: the API's `eventType` filter is an **exact match** although its DTO description says "prefix or exact";
   delivery rows are not links yet (they link to task 6's pages)._
6. **Deliveries pages**: status filter; detail with attempt timeline (status code, duration, response snippet, error).
   _Done (`26ef76e`): `/deliveries` lists one status at a time (links, not a form; status and page in
   the URL; unknown values fall back to dead letters) and `/deliveries/:id` shows the facts (event, subscription, target
   URL, attempts, retry and completion times) and an attempt timeline (status code, duration, error, response snippet;
   "Succeeded"/"Failed" always spelled out). New "Deliveries" header link; delivery rows on event detail and the Overview
   failure list now link to the detail page. 50 dashboard tests (10 new). Checked against a real local API.
   Notes: the API has **no "all statuses" option**, so the list cannot show every delivery at once, and its rows carry
   IDs only (no event type or subscription name). Both would need a small backend change; left for you to decide.
   Separate pre-existing bug found while testing, not fixed: on Node 24 the worker's SSRF `customLookup`
   (`apps/worker/src/delivery/http-dispatcher.service.ts`) receives an address array (`all: true`), so deliveries to
   hostnames fail with `SSRF_BLOCKED ... [object Object]`._
7. **Stop returning `signingSecret` on subscription read endpoints after creation** (decision 3; breaking API
   change). Own commit, with unit/integration tests and updates to the API docs/README.
   _Done (`2ba6648`): found that this was **already the behaviour** since the initial commit: `mapToResponseDto`
   omits the secret, and only the `POST` creation response includes it (list, get-by-id and delivery detail were already
   tested). So no API change was needed. Added the missing assertion that `PATCH` does not return it, documented the
   "shown once" rule in the README, and corrected `docs/deployment.md`, whose rotation steps told users to "update the
   subscription with a new secret", which the API cannot do (rotation is now: create a new subscription, verify both,
   disable the old one)._
8. **Subscriptions page**: create, edit, enable/disable; signing secret shown once on creation (see decision 3).
   _Done (`00b4d3b`): `/subscriptions` lists name, target URL, event types, rate limit and
   status, with a header link. "New subscription" opens a form (name, target URL, event types separated by commas
   or `*`, optional rate limit); the signing secret from the creation response appears once in a copy-to-clipboard
   notice and is gone after "I have saved it" (nothing stores it). Edit sends only the changed fields; Enable/Disable
   is a `PATCH` of `isActive`. API refusals (SSRF, validation) are shown using the API's own `detail`/`errors`.
   New `fetchSubscriptions`, `createSubscription`, `updateSubscription` in `lib/api.ts`. 64 dashboard tests (14 new).
   Checked against a real local API (create, SSRF 400, validation 400, disable, list); that check caught that error
   bodies are RFC 7807 (`detail`, `errors`), not `message`, which the first version assumed.
   Notes: delete is **not** in the task list, so there is no delete button (the API supports it). The API cannot
   clear a rate limit once set, so the edit form can change it but not remove it. Custom `headers` are not editable in
   the UI (API-only). Throwaway project `t8-check` left in the local dev DB._
9. **Dead-letter queue page**: single and batch replay.
   _Done (`450a0d8`): `/dead-letters` (header link "Dead letters") lists DEAD_LETTER deliveries
   with subscription name (looked up from `/v1/subscriptions`; falls back to a short ID), attempts, when it gave up and
   links to the delivery and event. Each row has **Replay** (`POST /v1/deliveries/:id/replay`); checkboxes plus a
   select-all for the page feed **Replay selected (n)** (`POST /v1/deliveries/replay` with `deliveryIds`, so at most the
   20 on a page, under the API's 50 cap). A notice reports the outcome (with a link to pending deliveries), lists any
   deliveries the API refused, then the list refreshes. New `replayDelivery`, `replayDeliveries` in `lib/api.ts` and a
   `conflict` failure for HTTP 409 ("no longer a dead letter"). 75 dashboard tests (11 new). Checked against a real
   local API: single replay 200 (PENDING, 3 more attempts), repeat replay 409, batch with one stale ID
   (`replayedCount` 1, `failedCount` 1), unknown ID 404, `/dashboard/dead-letters` 200.
   Notes: there is no "replay everything" button (the API's filter-only batch, up to 50, is unused); the API's
   per-item error text contains the full delivery UUID. The local worker was not running, so replayed deliveries stay
   PENDING; the full send-and-succeed flow is task 10's acceptance criterion. Throwaway project `t9-check` left in
   the local dev DB. A local API process started for the check is still running on port 3000._
10. **Sandbox mode**: "Send test event"; built-in demo receiver (always succeed, fail N times then succeed,
    always `500`, slow/timeout); restricted to a dedicated demo project; rate limited. Needs a narrow SSRF
    exception for the demo receiver's own address only.
    _Done (`ab92174`): off by default (`SANDBOX_ENABLED`, `SANDBOX_RECEIVER_URL`; env examples and
    `docker-compose.prod.yml` updated). **API** (`modules/sandbox`): public `POST /v1/sandbox/session` mints a 1-hour key
    for the one shared `sandbox` project (created on demand with one canonical subscription per scenario; expired keys
    are purged on each session); `POST /v1/sandbox/events {scenario}` ingests `sandbox.<scenario>`; the receiver is
    `POST /sandbox/receiver/{succeed|flaky|fail|slow}` (public, but answers 404 unless `X-EventForge-Delivery-Id` is a
    delivery of the sandbox project; flaky = 503 twice then 200, counted per delivery in Redis; fail = 500; slow = holds
    the connection until the worker times out, 60 s cap). `SandboxQuotaGuard` (after `ApiKeyGuard`): a sandbox key
    cannot create, change or delete subscriptions (403, so it cannot point the worker at an external URL) and its other
    writes (events, replays) are limited per IP and hour; sessions are limited too (defaults 10 and 60 per hour).
    **SSRF**: `isSandboxReceiverUrl` (packages/common) accepts only `<receiver base>/<known scenario>` with the same
    protocol, host and port, no query, fragment or credentials, compared after URL normalisation (dot segments cannot
    climb out); only those URLs skip the worker's private-address checks. **Also fixed**: the worker's DNS `lookup` hook
    broke on Node 24 (the address arrives as an array, so every hostname delivery failed with `SSRF_BLOCKED
[object Object]`, including public hosts); it now checks each address. **Dashboard**: "Try the live sandbox" on the
    landing page (no key needed), a `/sandbox` page (header link only in a sandbox session) with the four scenarios and a
    live status line per sent event (polls every 1.5 s until COMPLETED or DEAD_LETTER), linking to the event, delivery
    and dead-letter page for replay. Tests: API 150 (17 new integration, 20 unit), worker 46 (4 new), dashboard 87 (12
    new). Checked on a real API and worker (ports 3100/3101): succeed -> COMPLETED (1 attempt), flaky -> COMPLETED (3),
    fail -> DEAD_LETTER (5), slow -> DEAD_LETTER (5 timeouts), replay of the dead letter -> 200 and a fresh attempt,
    subscription write with a sandbox key -> 403.
    Notes: every visitor shares one project, so visitors see each other's events (a per-visitor project would need
    cleanup). The `slow` scenario assumes `WEBHOOK_TIMEOUT_MS` is below 60 s. The receiver does not verify the HMAC
    signature. Throwaway `sandbox` project and a few events left in the local dev DB._

11. **Responsive and theming pass**: phone width, light and dark mode (shadcn CSS variables), and a check of
    every animation against reduced motion. See `docs/dashboard-design.md`.
    _Done (`fcd5960`): **Theme**: the dark tokens already existed but nothing switched them; a
    `ThemeToggle` (System, Light, Dark; one button, on the landing page and the signed-in header) sets the `dark` class
    on `<html>`, follows the OS while on System (including live changes), and is remembered in `localStorage` (guarded
    against storage errors; the API key stays in `sessionStorage` only). It is applied in `main.tsx` before the first
    render, so there is no light flash (an inline script would break the dashboard CSP). `color-scheme` is set so native
    controls match. **Phone width**: checked with headless Chrome at 375 px and 1100 px, light and dark, on every
    signed-in page and the landing page, measuring horizontal overflow. Found and fixed one real overflow: on Overview the
    chart forced the grid column wider than the screen (the status list's counts ran off the card); the grid column is now
    `minmax(0, 1fr)`. The header nav now wraps; stat numbers are `text-2xl` below `sm`. Tables still scroll sideways inside
    their box, as designed. **Reduced motion**: the landing explainer was already static under the preference (re-checked in a
    real browser: no moving dot, no Pause button, no active step); the refresh spinners had `motion-reduce:animate-none`;
    a global `prefers-reduced-motion` rule in `index.css` now cuts any remaining animation or transition to an instant
    change; Recharts bar animation is switched off (decorative). **Bundle**: Recharts is lazy-loaded (`StatusBarChart`),
    which removes the 500 kB chunk warning (main 495 kB, chart 354 kB) and shows the numbers before the bars. Tests: 95
    dashboard (8 new: theme storage, system detection, toggle cycle).
    Notes: with bar animation on, the bars stayed empty in headless Chrome once the chart was lazy-loaded; I could not tell
    whether real browsers are affected, so animation is off for good rather than guessed at. The explainer's travelling dot
    covers part of the "Outbox" label for a moment (cosmetic, from task 3). On phones the nav takes two rows. Dark-mode
    colours were judged from screenshots, not measured for WCAG contrast. Throwaway key `t11-visual` on project `t9-check`
    left in the local dev DB; an old local API process is still running on port 3000._
12. **Tests and docs**: extend `smoke-test:remote` to cover `/dashboard` and the new endpoints; README and docs.
    _Done (`fd45c83`): `scripts/smoke-test-remote.ts` is now 11 steps (25 checks without
    `METRICS_TOKEN`). New: event detail includes `deliveries`; `/v1/stats` (401 without a key, documented shape, counts
    the ingested event, 400 for `windowHours=0`); `/dashboard` (HTML with `no-cache`, `/dashboard/events` falls back to
    `index.html`, same-origin CSP without `unsafe-eval`, every `src`/`href` in `index.html` is a `/dashboard/` path,
    hashed asset is `immutable`, missing file is 404); sandbox (404 when off, 201 with `apiKey` when on, so it is
    valid on either config). README: dashboard and sandbox in the feature list, layout, a "Open the Dashboard" quick-start
    step, scripts table. `docs/deployment.md`: smoke-test list and a "Dashboard and Sandbox" section. Verified by running
    the built API (dev config, port 3100) with a throwaway key: all new checks pass; the only failure is the existing
    `/metrics` check, because that dev API has no `METRICS_TOKEN`. Lint, typecheck and Prettier clean; no source
    changes, so unit and integration tests were not re-run.
    Notes: not run against the real prod Docker stack, so the worker-port and `/metrics` checks and the prod CSP
    were not exercised there. The new checks could not be shown failing against a broken server, only passing.
    Throwaway project `t12-check` and key `t12` left in the local dev DB._

**Acceptance criteria**

- [x] `pnpm build` produces the dashboard bundle; the API serves it at `/dashboard` in both dev and
      the prod Docker image (no extra container).
      _Checked: dev and `smoke-test:remote` against the built API (task 12); the prod Docker image was checked in task 2._
- [x] Logging in with a valid key shows only that project's data; an invalid key shows an error and
      no data.
      _Tenant isolation covered by API integration tests (task 1); sign-in errors by component tests (task 3)._
- [x] All pages listed above work end to end against a real local stack.
      _Each page was checked against a real local API in its own task (4 to 10)._
- [x] In sandbox mode, a visitor can send an event and watch it move
      `PENDING → IN_FLIGHT → FAILED → … → COMPLETED` (or `DEAD_LETTER`) and then replay it from the
      DLQ page.
      _Checked end to end on a real API and worker in task 10 (all four scenarios, plus replay)._
- [x] The demo receiver cannot be pointed at external URLs, and sandbox actions are rate limited.
- [x] New backend endpoints have unit/integration tests; existing tests still pass.
      _Full suites re-run at the end of Phase 2: unit 200 (API 74, worker 31, dashboard 95); integration 91 (API 76, worker 15)._
- [x] Dashboard is usable at phone width and in light and dark mode.
      _Checked in headless Chrome at 375 px and 1100 px (task 11). Dark-mode contrast was judged by eye, not measured._
- [x] The landing page explainer plays, can be paused, and falls back to a static diagram with all captions
      when the visitor prefers reduced motion; covered by a component test.
- [x] The dashboard loads no third-party resources (fonts and scripts are bundled) and works under the
      `/dashboard` CSP.
      _`smoke-test:remote` now checks the CSP and that `index.html` references only `/dashboard/` paths (task 12)._

---

## Phase 3 — Free Deployment: tasks and acceptance criteria

**Status: 🔄 Moved here while two items remain open (2026-11-12):** the Azure credit burn rate, and the flaky-test fix
(`fcbc8df`) not yet seen green in CI. Both are tracked in `PLAN.md`. The text below is the Phase 3 detail as it stood when
the wording and archive pass (task 8) was done; commit hashes for each task are in the table.

**Environment (done by the user):** Azure for Students account; VM `eventforge-vm` created in East Asia
(Standard_B2ats_v2, Ubuntu 24.04, Standard SKU static public IP, NSG allows 22/80/443); SSH login verified. The private
key lives only in `~/.ssh` and is never committed or shared.

**Tasks**

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                             |
| :-- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| 1   | **Caddy** in `docker-compose.prod.yml` as the only public entry point (80/443, automatic certificate), API bound to `127.0.0.1`, `TRUST_PROXY_HOPS=1`. Tested locally behind Caddy: `smoke-test:remote` 28/28; a forged `X-Forwarded-For` is ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ `6947ff2`                       |
| 2   | **Prebuilt images:** CI `publish-images` job pushes API and worker images to GHCR on `main`; compose pulls them (`pull` then `up -d --no-build`). Replaces the old "arm64 builds" task: the VM is x64. The first CI run failed because the worker image copied `packages/sdk/dist`, which the worker never builds (masked locally by a stale `dist` that `.dockerignore` did not exclude); fixed in `3777291`, CI green on 2026-11-12.                                                                                                                                                                                                                                                          | ✅ `a895809`, `3777291`            |
| 3   | **Memory limits for 1 GiB:** per-service `mem_limit`s (api 224m, worker 192m, postgres 160m, redis 48m, caddy 48m; all env-overridable), V8 heap caps below them, Postgres tuned (`shared_buffers=24MB`, `max_connections=40`), Redis `maxmemory 32mb` with `noeviction`, DB pools 10 each. Measured locally: idle ~455 MiB unlimited; with limits, `smoke-test:remote` 28/28 and 600 events at concurrency 20 peak at ~200 MiB total, no OOM kills. Real 1 GiB check happens in task 5.                                                                                                                                                                                                        | ✅ `45db147`                       |
| 4   | **`docs/deploy-azure-student.md`:** VM and NSG recap, 2 GB swap, Docker install, `.env.production` (generate secrets on the VM), first deploy, seeding the demo project and sandbox, backups, stopping/deallocating the VM to save credit, checking remaining credit.                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ `9dbc416`                       |
| 5   | **First deploy and verification** on the VM against every acceptance criterion below (needs the commits pushed, CI green, and both GHCR packages public). Done 2026-11-12: `smoke-test:remote` 28/28 against the public URL, only ports 22/80/443 open, ~213 MiB used with no OOM kills, reboot recovery. Open: the credit burn rate.                                                                                                                                                                                                                                                                                                                                                           | 🔄 `023edc7` (burn rate open)      |
| 6   | **Fallback doc:** run locally and expose with Tailscale Funnel or a Cloudflare quick tunnel, for when the Azure credit ends. `docs/deploy-fallback.md`: the local stack was verified (`smoke-test:remote` 28/28 on plain HTTP); the tunnel commands were not run. Notes that all visitors share one client IP behind a tunnel, so the sandbox's per-IP limits need raising.                                                                                                                                                                                                                                                                                                                     | ✅ `6965f8e`                       |
| 7   | **Optional CD:** after a green CI run on `main`, a workflow deploys to the VM over SSH (`pull` + `up -d --no-build`). Only after the manual deploy works. Built as `deploy/deploy.sh` (`2dd61f1`, tested locally: healthy, repeat, unhealthy worker, bad tag, missing env), the `deploy` job in `ci.yml` (`1a74ebf`, lints clean with actionlint; off until the `DEPLOY_URL` variable is set) and the setup guide (`838568c`). Uses a deploy key restricted to the script and a pinned host key. **Verified** in CI run `43280734434` (2026-11-12): deploy over SSH and `/v1/ready` check green. The first attempt failed only at the check, from a leading space in the `DEPLOY_URL` variable. | ✅ `2dd61f1`, `1a74ebf`, `838568c` |
| 8   | **Plan and docs wording:** archive the Phase 3 details, refresh baselines, and correct any docs that still mention Oracle or arm64.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ (this move)                     |

**What you need to do (user steps)**

1. ~~**Push** the Phase 3 commits to `main` and wait for CI to go green.~~ Done (2026-11-12); the green run published the images.
2. ~~**Make both GHCR packages public**~~ Done (2026-11-12). Path, for reference: GitHub profile, Packages, `eventforge-api` and
   `eventforge-worker`, Package settings, Change visibility. Otherwise the VM cannot pull them.
3. **At first deploy** (task 5), on the VM: clone the repo (or copy `docker-compose.prod.yml` and `deploy/`), create
   `.env.production` with generated secrets (`openssl rand -hex 24`), and run the compose commands from the guide. Never
   paste secrets into chat or commit them.
4. **Keep an eye on the Azure credit** (Cost Management + Billing) and stop or deallocate the VM when the demo is not
   needed.
5. **For CD (task 7):** follow "Automatic deploys" in `docs/deploy-azure-student.md`: create a dedicated deploy key, authorise it
   on the VM pinned to `deploy/deploy.sh`, add the secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY` and `SSH_KNOWN_HOSTS`, and last the
   variable `DEPLOY_URL`, which switches the job on.

**Acceptance criteria**

- [x] Only ports 80/443 (and SSH) are reachable on the VM; Postgres, Redis, the worker, and `/metrics` without its token
      are not.
- [x] `https://40-81-24-8.sslip.io/v1/health` returns `200` with a valid certificate.
- [x] `https://40-81-24-8.sslip.io/dashboard` loads and the sandbox flow works on the live server.
- [x] `pnpm smoke-test:remote` passes against the public URL. (28/28)
- [x] The stack fits in 1 GiB: no out-of-memory kills across the smoke test and a sandbox session (checked with
      `docker stats` and `dmesg`).
- [x] Stack recovers automatically after a VM reboot (`restart: unless-stopped`, volumes persist, certificate kept).
      Services and certificate came back on their own, and sandbox events from before the reboot were still there.
- [x] Following `docs/deploy-azure-student.md` from scratch produces a working deployment. Followed on the fresh
      VM; the corrections it needed are in `023edc7`.
- [ ] Out-of-pocket cost is $0: no payment method attached, and the credit's burn rate and expected end date are
      recorded in the guide. No payment method is attached and a budget alert exists (8,500 INR, alerts at 50% and 80%);
      the burn rate waits for the first Cost Management data.
- [x] (If CD is done) a push to `main` that passes CI redeploys the server without manual steps. Verified in CI run
      `43280734434`.

**Also done during Phase 3**

- **Flaky test fixed (`fcbc8df`).** `turbo run test` ran the API and worker suites in parallel on one shared PostgreSQL;
  the worker's outbox pollers could claim the row that the API concurrency test had just created, so it saw `PROCESSED`
  instead of `PENDING` (one CI failure; reproduced locally in 4 of 12 runs). `test` and `test:integration` now run with
  `--concurrency=1`. Not yet seen green in CI after the change.
- **CI concurrency changed (`1a74ebf`).** Only pull request runs are cancelled by a newer push; runs on `main` finish, so
  a deploy is never killed halfway.

**Risks and notes**

- Usable RAM on the VM is about 836 MiB, not 1 GiB. Caddy sits at about 85% of its 48 MiB limit; raise
  `CADDY_MEM_LIMIT` to 64m if it is ever OOM-killed (a small compose and docs change, not made yet).
- The smoke test leaves a `smoke-test` project in the production database; harmless.
- The credit is finite (about 6 months at this size). When it ends the VM stops; the fallback path keeps the demo
  available.
- 1 GiB RAM is tight. If it proves too small, resize to B2als_v2 (4 GiB, ~$38/month, about 2 months of credit) in the
  portal. Do this temporarily for the Phase 4 load test, which would otherwise throttle the burstable CPU.
- sslip.io is shared, so Let's Encrypt's per-domain certificate limit can be hit by other users. Caddy falls back to
  another CA; if both fail, switch to DuckDNS.
- The first `docker compose pull` fails if the GHCR packages are still private.
- Every push to `main` that passes CI now redeploys the server (CD is on while the `DEPLOY_URL` variable exists; delete it
  to turn CD off). A deploy that does not become healthy fails the job but does not roll itself back; see the guide.
- Behind a fallback tunnel all visitors share one client IP, so per-IP limits (including the sandbox's 10 sessions per
  hour) are shared. The guide says to raise the sandbox limits. A proper fix is Caddy `trusted_proxies`, deferred until the
  fallback is actually used and can be tested.
- A `DEPLOY_URL` saved with a stray space breaks the post-deploy check (hit once; documented in the guide). Trimming it in
  the workflow is an optional hardening, not done.
