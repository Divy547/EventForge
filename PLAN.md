# EventForge — Completion & Deployment Plan

_Last updated: 2026-11-12_

**Completed-phase details:** `docs/plan-archive.md`
**Dashboard design:** `docs/dashboard-design.md` (read only for tasks 3 and 11)

This document tracks the work needed to take EventForge from a working codebase to a publicly
deployed, portfolio-ready project. Each phase begins only after explicit approval.

**Status:** Phase 1 is **implemented and committed** (2026-11-12). Phase 2 is **approved and in
progress**: task 1 (backend endpoints) is committed as `fc7dd20`; task 2 (dashboard scaffold) is committed as `43bff6a`;
task 3 (login / landing page) is committed as `e82fa8c`; task 4 (Overview page) is committed as `61402a4` (see Phase 2). task 5 (Events pages) is committed as `3e92e81`. Task 6 (Deliveries pages) is committed as `26ef76e`. Task 7 is committed as `2ba6648`. Task 8 (Subscriptions page) is committed as `00b4d3b`. Task 9 (Dead-letter queue page) is committed as `450a0d8`. Task 10 (Sandbox mode) is committed as `ab92174`. Task 11 (responsive and theming pass) is committed as `fcd5960`. Task 12 is next, awaiting approval.

---

## 1. Goals

1. Deploy EventForge publicly at **zero cost**, reachable over HTTPS.
2. Add a **web dashboard** so non-technical visitors (recruiters, interviewers) can see the system
   working without using `curl`.
3. Make the project **defensible in interviews**: accurate docs, real benchmark numbers, and a clear
   understanding of every design decision.
4. Build history through **small, meaningful commits** rather than large dumps.

## 2. Decisions So Far

| Topic                           | Decision                                                                                                                                                                                                                                                                  |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Budget                          | **$0.** No paid hosting, domains, or services.                                                                                                                                                                                                                            |
| Domain                          | **None for now.** Use a free subdomain (DuckDNS or sslip.io) with automatic HTTPS via Caddy.                                                                                                                                                                              |
| Primary hosting                 | **Oracle Cloud Always Free** ARM VM (Ampere A1) running the Docker Compose stack.                                                                                                                                                                                         |
| Fallback hosting                | Local machine + **Cloudflare quick tunnel** (`*.trycloudflare.com`) for live demos, plus a recorded demo GIF/video in the README.                                                                                                                                         |
| Avoided                         | Render/Railway free tiers + Upstash/Neon: services sleep, and continuous outbox polling exhausts free Redis command quotas.                                                                                                                                               |
| Dashboard                       | **Yes.** React + Vite static SPA, served by the existing API at `/dashboard` (no extra container).                                                                                                                                                                        |
| Dashboard UI stack (decision 1) | **Tailwind CSS + shadcn/ui** (Radix primitives), charts via the **shadcn chart component (Recharts)**, animation via the **`motion`** package (`framer-motion`'s current name, imported from `motion/react`). Chose a component library and chart library over plain CSS. |
| Dashboard look                  | **Direction C, "Pipeline"**: dark navy header and hero over a light page, built around the event flow. Mockups: https://claude.ai/artifact/CCGA7tz2nwv5hByH3VoNT9 (private link).                                                                                         |
| Landing page                    | The pre-login page: headline, API-key sign-in, "Try the live sandbox", an **animated explainer** of what EventForge does, and four feature cards. Animation is **rebuilt with `motion`** (not plain CSS).                                                                 |
| Design skill                    | The third-party `ui-ux-pro-max-skill` repo was reviewed (read-only, 2026-11-12) and **not adopted**; our own three directions already cover its checklist.                                                                                                                |
| Dashboard auth                  | User pastes a project API key; kept in `sessionStorage` only.                                                                                                                                                                                                             |
| Frontend tests (decision 2)     | **Vitest component tests**.                                                                                                                                                                                                                                               |
| Signing secret on reads (3)     | **Stop returning `signingSecret`** after creation, so it is shown only once (breaking API change).                                                                                                                                                                        |
| Workflow                        | One concern per commit; changes reviewed before committing; no implementation without approval.                                                                                                                                                                           |
| Subscription rate limit         | **Enforce** `rateLimitPerSecond` in the worker (decided during Phase 1) rather than removing the field.                                                                                                                                                                   |
| Prod smoke test                 | **HTTP-only** `pnpm smoke-test:remote` for prod-configured stacks (decided during Phase 1). Delivery stays covered by `pnpm smoke-test`.                                                                                                                                  |

## 3. Baseline after Phase 1 (2026-11-12)

| Check                                     | Result                                         |
| :---------------------------------------- | :--------------------------------------------- |
| `pnpm typecheck`, `lint`, `format:check`  | ✅ Clean                                       |
| `pnpm test:unit`                          | ✅ 68/68 (API 41, worker 27)                   |
| `pnpm test:integration` (real PG + Redis) | ✅ 63/63 (API 48, worker 15)                   |
| `pnpm smoke-test`                         | ✅ 11/11 (spawns built API and worker locally) |
| `pnpm smoke-test:remote` (prod compose)   | ✅ 16/16                                       |

---

## 4. Phases

### Phase 1 — Production Hardening

**Status: ✅ Complete (2026-11-12).** Implemented as eight commits, one concern each:

| Commit    | Change                                                                       |
| :-------- | :--------------------------------------------------------------------------- |
| `2fd157f` | Admin CLI for projects and API keys (`pnpm admin <cmd>`)                     |
| `e93ebc0` | Rate limiting (Redis, per IP and per API key), helmet, CORS allow-list       |
| `83ad4e8` | Token-protected `/metrics`, worker port closed, `POSTGRES_PASSWORD` required |
| `8c3c2ec` | Per-subscription `rateLimitPerSecond` enforced (slot reservation in Redis)   |
| `7ed0e40` | Data retention job                                                           |
| `ed51d43` | Automatic `migrate` service; Docker image fix; prod compose project name     |
| `fcd0367` | HTTP-only smoke test for a running production stack                          |
| `aa14f7d` | Documentation corrections and new feature docs                               |

---

### Phase 2 — Dashboard

**Status: 🚧 In progress (approved 2026-11-12).** Tasks 1–6 are committed; task 7 is committed as `2ba6648`; task 8 is committed as `00b4d3b`; task 9 is committed as `450a0d8`; task 10 is committed as `ab92174`; task 11 is committed as `fcd5960`; task 12 has not been started.

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

**Acceptance criteria**

- [ ] `pnpm build` produces the dashboard bundle; the API serves it at `/dashboard` in both dev and
      the prod Docker image (no extra container).
- [ ] Logging in with a valid key shows only that project's data; an invalid key shows an error and
      no data.
- [ ] All pages listed above work end to end against a real local stack.
- [ ] In sandbox mode, a visitor can send an event and watch it move
      `PENDING → IN_FLIGHT → FAILED → … → COMPLETED` (or `DEAD_LETTER`) and then replay it from the
      DLQ page.
- [ ] The demo receiver cannot be pointed at external URLs, and sandbox actions are rate limited.
- [ ] New backend endpoints have unit/integration tests; existing tests still pass.
- [ ] Dashboard is usable at phone width and in light and dark mode.
- [ ] The landing page explainer plays, can be paused, and falls back to a static diagram with all captions
      when the visitor prefers reduced motion; covered by a component test.
- [ ] The dashboard loads no third-party resources (fonts and scripts are bundled) and works under the
      `/dashboard` CSP.

---

### Phase 3 — Free Deployment

**Tasks**

1. Add **Caddy** to `docker-compose.prod.yml` as the only public entry point (ports 80/443), with
   automatic Let's Encrypt certificates for the free subdomain.
2. Verify **multi-arch (arm64)** Docker builds for API and worker.
3. Write **`docs/deploy-oracle-free.md`**: account creation (done by the user), VM creation, firewall
   / security list rules, Docker install, DuckDNS or sslip.io setup, `.env.production`, first deploy,
   seeding a demo project, backups.
4. **Optional CD**: GitHub Actions builds images, pushes to GitHub Container Registry (free), and
   deploys to the VM over SSH.
5. **Fallback path**: documented local + Cloudflare quick tunnel instructions.

**Acceptance criteria**

- [ ] Only ports 80/443 (and SSH) are reachable on the VM; Postgres, Redis, worker, and metrics are
      not.
- [ ] `https://<subdomain>/v1/health` returns `200` with a valid certificate.
- [ ] `https://<subdomain>/dashboard` loads and the sandbox flow works on the live server.
- [ ] `pnpm smoke-test:remote` passes against the public URL.
- [ ] Stack recovers automatically after a VM reboot (`restart: unless-stopped`, volumes persist).
- [ ] Following `docs/deploy-oracle-free.md` from scratch produces a working deployment.
- [ ] Monthly cost is $0.
- [ ] (If CD is done) a push to `main` that passes CI redeploys the server without manual steps.

---

### Phase 4 — Portfolio Polish & Interview Readiness

**Tasks**

1. Run `pnpm load-test` against the deployed instance; record throughput and p50/p95/p99 latency.
2. README: live demo link, demo GIF/video, measured numbers, "Design Decisions" section (outbox vs
   direct publish, `SKIP LOCKED`, at-least-once vs exactly-once, lease-based crash recovery,
   SSRF/DNS-rebinding defence, backoff with jitter).
3. Replace unverifiable marketing language ("production-grade") with measured facts.
4. Concept walkthrough and Q&A practice covering every major component.
5. Draft resume bullet points based on measured results.

**Acceptance criteria**

- [ ] README shows a working live link (or clearly marked fallback demo video) and real benchmark
      numbers with the hardware they were measured on.
- [ ] Every claim in README and docs is backed by code, a test, or a measurement.
- [ ] The user can explain, without notes: the transactional outbox, `FOR UPDATE SKIP LOCKED`,
      idempotency via `ON CONFLICT`, at-least-once delivery and consumer idempotency, lease-based
      crash recovery, retry classification and backoff, DLQ replay, HMAC signing and verification,
      and SSRF protection.
- [ ] 2–3 resume bullets are written, each tied to a verifiable feature or number.

---

## 5. Working Agreement

- No implementation starts until the user approves the phase (or individual task).
- Each task is a small, focused commit with a descriptive message.
- All quality gates (typecheck, lint, format, unit, integration tests) must pass before each commit.
- The user creates and owns all external accounts (Oracle Cloud, DuckDNS, GitHub secrets); no
  credentials are committed to the repository.
