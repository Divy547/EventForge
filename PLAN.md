# EventForge — Completion & Deployment Plan

_Last updated: 2026-11-12 (Phase 4: tasks 1-5 done, the load test, the README rewrite, the claims pass, the interview guide and the resume bullets; Phase 3 only lacks the credit burn rate)_

**Completed-phase details (Phase 1 and 2):** `docs/plan-archive.md`
**Dashboard design:** `docs/dashboard-design.md` (Phase 2 reference)

This document tracks the work needed to take EventForge from a working codebase to a publicly
deployed, portfolio-ready project. Each phase begins only after explicit approval.

**Status:** Phases 1 and 2 are **complete and committed** (2026-11-12). Phase 3 (free deployment) is **nearly complete**:
the stack is live at `https://40-81-24-8.sslip.io`, the fallback doc is written, automatic deploys from CI work, the
Phase 3 details are archived (task 8), and CI is green after the flaky-test fix (runs `43285625950`, `43287724411`). **Remaining:** record
the credit burn rate (waits on Azure Cost Management data).

Phase 4 (portfolio polish) is **in progress**: task 1 (load test, run locally) is done and led to a worker fix
(`e0f9600`); task 2 (README rewrite, `325b2e1`) is done; task 3 (claims pass, `8aac462`, `ead7b54`) is done in part
(see its note); task 4 (interview guide, `146233b`) and task 5 (resume bullets, `f86f6ba`) are done.

---

## 1. Goals

1. Deploy EventForge publicly at **zero cost**, reachable over HTTPS.
2. Add a **web dashboard** so non-technical visitors (recruiters, interviewers) can see the system
   working without using `curl`.
3. Make the project **defensible in interviews**: accurate docs, real benchmark numbers, and a clear
   understanding of every design decision.
4. Build history through **small, meaningful commits** rather than large dumps.

## 2. Decisions So Far

| Topic                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Budget                          | **$0 out of pocket.** No paid hosting, domains, or services, and no payment method attached anywhere. Hosting runs on the Azure for Students credit (see below).                                                                                                                                                                                                                                                                                                                                                    |
| Domain                          | **None.** Hostname `<ip-with-dashes>.sslip.io` (the VM's static IP gives `40-81-24-8.sslip.io`) with an automatic Let's Encrypt certificate from Caddy. DuckDNS is the fallback if sslip.io's shared certificate rate limit bites.                                                                                                                                                                                                                                                                                  |
| Primary hosting                 | **Azure for Students** VM `eventforge-vm` (Ubuntu 24.04, x64, **Standard_B2ats_v2**: 2 vCPU, 1 GiB RAM, ~$9.56/month) in **East Asia**, running the Docker Compose stack. Changed from Oracle Cloud Always Free on 2026-11-12 because Oracle rejected the user's debit card. East Asia and this size were the only combination the student subscription allowed (D-series and most regions return `NotAvailableForSubscription`). The ~$100 credit lasts roughly 6 months; after that the VM stops, with no charge. |
| Fallback hosting                | The stack on the user's own machine, exposed with **Tailscale Funnel** (stable `*.ts.net` HTTPS URL, no domain) or a **Cloudflare quick tunnel** (URL changes on restart), plus a recorded demo GIF/video in the README. Used when the credit runs out.                                                                                                                                                                                                                                                             |
| Avoided                         | Render/Railway free tiers + Upstash/Neon: services sleep, and continuous outbox polling exhausts free Redis command quotas.                                                                                                                                                                                                                                                                                                                                                                                         |
| Dashboard                       | **Yes.** React + Vite static SPA, served by the existing API at `/dashboard` (no extra container).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Dashboard UI stack (decision 1) | **Tailwind CSS + shadcn/ui** (Radix primitives), charts via the **shadcn chart component (Recharts)**, animation via the **`motion`** package (`framer-motion`'s current name, imported from `motion/react`). Chose a component library and chart library over plain CSS.                                                                                                                                                                                                                                           |
| Dashboard look                  | **Direction C, "Pipeline"**: dark navy header and hero over a light page, built around the event flow. Mockups: https://claude.ai/artifact/CCGA7tz2nwv5hByH3VoNT9 (private link).                                                                                                                                                                                                                                                                                                                                   |
| Landing page                    | The pre-login page: headline, API-key sign-in, "Try the live sandbox", an **animated explainer** of what EventForge does, and four feature cards. Animation is **rebuilt with `motion`** (not plain CSS).                                                                                                                                                                                                                                                                                                           |
| Design skill                    | The third-party `ui-ux-pro-max-skill` repo was reviewed (read-only, 2026-11-12) and **not adopted**; our own three directions already cover its checklist.                                                                                                                                                                                                                                                                                                                                                          |
| Dashboard auth                  | User pastes a project API key; kept in `sessionStorage` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Frontend tests (decision 2)     | **Vitest component tests**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Signing secret on reads (3)     | **Stop returning `signingSecret`** after creation, so it is shown only once (breaking API change).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Image delivery                  | CI builds the API and worker images and publishes them to **GHCR** (`ghcr.io/divy547/eventforge-*`, tags `latest` and `sha-<commit>`); the VM only pulls. **Never build on the VM**: 1 GiB RAM is not enough.                                                                                                                                                                                                                                                                                                       |
| Public sandbox                  | **On** for the public instance (decided 2026-11-12); per-IP hourly limits apply, and all visitors share one demo project.                                                                                                                                                                                                                                                                                                                                                                                           |
| Workflow                        | One concern per commit; changes reviewed before committing; no implementation without approval.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Subscription rate limit         | **Enforce** `rateLimitPerSecond` in the worker (decided during Phase 1) rather than removing the field.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Prod smoke test                 | **HTTP-only** `pnpm smoke-test:remote` for prod-configured stacks (decided during Phase 1). Delivery stays covered by `pnpm smoke-test`.                                                                                                                                                                                                                                                                                                                                                                            |

## 3. Baseline (2026-11-12, after Phase 4 task 1)

| Check                                     | Result                                                                         |
| :---------------------------------------- | :----------------------------------------------------------------------------- |
| `pnpm typecheck`, `lint`, `format:check`  | ✅ Clean                                                                       |
| `pnpm test:unit`                          | ✅ 208/208 (API 74, worker 39, dashboard 95)                                   |
| `pnpm test:integration` (real PG + Redis) | ✅ 91/91 (API 76, worker 15)                                                   |
| `pnpm smoke-test:remote`                  | ✅ 28/28 against the public URL `https://40-81-24-8.sslip.io` (Phase 3 task 5) |

Gates re-run on 2026-11-12 after Phase 4 task 1 (typecheck was served from the Turbo cache): the worker gained 8 unit tests
for the outbox drain loop, so unit tests went from 200 to 208; integration counts are unchanged. The Phase 1 baseline is in
`docs/plan-archive.md`.

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

**Status: ✅ Complete (2026-11-12).** Twelve tasks, one commit each. Task notes and acceptance criteria:
`docs/plan-archive.md`.

| Task | Commit    | Change                                                                              |
| :--- | :-------- | :---------------------------------------------------------------------------------- |
| 1    | `fc7dd20` | `GET /v1/stats` and deliveries on event detail                                      |
| 2    | `43bff6a` | Dashboard scaffold (Vite, Tailwind, shadcn/ui), served at `/dashboard`, CSP         |
| 3    | `e82fa8c` | Landing page, API-key sign-in, animated explainer                                   |
| 4    | `61402a4` | Overview page                                                                       |
| 5    | `3e92e81` | Events list and detail                                                              |
| 6    | `26ef76e` | Deliveries list and detail                                                          |
| 7    | `2ba6648` | Signing secret shown only once (tests and docs; API already did this)               |
| 8    | `00b4d3b` | Subscriptions page                                                                  |
| 9    | `450a0d8` | Dead-letter page with single and batch replay                                       |
| 10   | `ab92174` | Sandbox mode with a built-in demo receiver (and a Node 24 worker DNS fix)           |
| 11   | `fcd5960` | Theme toggle, phone-width fixes, reduced-motion pass                                |
| 12   | `fd45c83` | `smoke-test:remote` covers stats, dashboard and sandbox; README and deployment docs |

**Carry-over notes** (known limits, none blocking):

- All sandbox visitors share one project, so they see each other's events.
- `eventType` filter on the events list is an exact match, although the DTO text says prefix.
- The deliveries list has no "all statuses" option and its rows carry IDs only.
- No delete button for subscriptions and no "replay all" on the dead-letter page; the API cannot clear a
  subscription rate limit once set.
- Dark-mode colours were judged by eye, not measured for WCAG contrast. The explainer's travelling dot briefly
  covers the "Outbox" label. Recharts bar animation is off.
- `smoke-test:remote` has not been run against the prod Docker stack since the dashboard was added (only against the
  built API with the dev config), and `pnpm smoke-test` was not re-run in Phase 2.
- Throwaway projects `sandbox`, `t5-*`, `t6-check`, `t8-check`, `t9-check`, `t12-check` remain in the local dev DB; an
  old local API process may still be running on port 3000.

---

### Phase 3 — Free Deployment

**Status: 🔄 Nearly complete (started 2026-11-12).** The stack runs on an Azure for Students VM at
`https://40-81-24-8.sslip.io`. Task notes, the user-steps list, acceptance criteria and the full risk notes:
`docs/plan-archive.md`. Operating guides: `docs/deploy-azure-student.md`, `docs/deploy-fallback.md`.

| Task | Commit                          | Change                                                                                 |
| :--- | :------------------------------ | :------------------------------------------------------------------------------------- |
| 1    | `6947ff2`                       | Caddy as the only public entry point (80/443, automatic certificate)                   |
| 2    | `a895809`, `3777291`            | CI publishes API and worker images to GHCR; compose pulls them (never build on the VM) |
| 3    | `45db147`                       | Memory limits and tuning for a 1 GiB host                                              |
| 4    | `9dbc416`                       | `docs/deploy-azure-student.md`                                                         |
| 5    | `023edc7`                       | First deploy and verification: `smoke-test:remote` 28/28, reboot recovery              |
| 6    | `6965f8e`                       | `docs/deploy-fallback.md` (local stack behind Tailscale Funnel or a Cloudflare tunnel) |
| 7    | `2dd61f1`, `1a74ebf`, `838568c` | Automatic deploys over SSH after green CI (verified in CI run `43280734434`)           |
| 8    | `c56df4f`                       | Phase 3 details moved to the archive; no Oracle or arm64 mentions remain in the docs   |

Also: `fcbc8df` runs package test suites one at a time (a flaky API test shared a database with the worker); `1a74ebf`
stops newer pushes from cancelling runs on `main`.

**Still open**

- [ ] **Credit burn rate and expected end date** recorded in `docs/deploy-azure-student.md` (waits on the first Azure Cost
      Management data). This is the only unchecked Phase 3 acceptance criterion. A budget alert exists (8,500 INR, alerts at
      50% and 80%) and no payment method is attached.
- [x] **Flaky-test fix seen green in CI** (runs `43285625950` and `43287724411`, 2026-11-12, with `--concurrency=1`,
      each including the SSH deploy). Two green runs are evidence rather than proof; the failure appeared in 4 of 12 local
      runs before the fix.
- [x] **Baselines refreshed** (section 3): all gates clean, 200 unit and 91 integration tests passing.

**Notes that still matter**

- Usable RAM on the VM is about 836 MiB. If Caddy is OOM-killed, raise `CADDY_MEM_LIMIT` to 64m.
- The credit lasts about 6 months; when it ends the VM stops and the fallback guide keeps the demo available.
- Every push to `main` that passes CI redeploys the server while the `DEPLOY_URL` variable exists (delete it to turn CD off).
  A deploy that does not become healthy fails the job but does not roll back.

---

### Phase 4 — Portfolio Polish & Interview Readiness

**Status: 🔄 In progress (started 2026-11-12).** Tasks 1-5 are done (task 3 with a gap, see its note). Open acceptance
criteria: every claim backed (the task 3 gap) and the user explaining the design without notes.

**Tasks**

1. ✅ **Load test, run locally** (decided 2026-11-12: no run against the deployed instance, see the note below).
   Findings and numbers are under "Task 1 results". It also produced a worker fix, `e0f9600`.
2. ✅ **README rewrite** (`325b2e1`, 360 to about 180 lines). Cut the duplicated production steps, the full command table,
   the API tutorial and the marketing wording. Added the live demo link, a pipeline diagram, nine design decisions (outbox,
   idempotent ingestion, `SKIP LOCKED`, at-least-once, lease recovery, retry classification and jittered backoff, HMAC
   signing, two-point SSRF defence, the fan-out ceiling), and the local benchmark table with hardware and caveats. Each
   decision was checked against the code. **Not done:** a demo GIF or video (only the user can record it; optional, the live
   link meets the criterion). The live sandbox was not clicked through, to avoid creating a session on the public demo.
3. ✅ **Replace unverifiable marketing language with measured facts** (`8aac462`, `ead7b54`). Removed "production-grade",
   "high availability", "zero message loss", "never vanish", "without fail" and similar from `docs/architecture.md`,
   `docs/README.md`, the Swagger description, the landing-page feature card and an SDK comment. "Guaranteed delivery" now
   reads as retry until `2xx` or dead-lettered. Tracing is described as propagation only (no spans exported).
   `OUTBOX_LOCK_TIMEOUT_MS` was **removed** rather than wired (wiring it would have cut the reclaim window from 5 minutes to
   30 s). Also corrected: key rotation (admin CLI, not SQL), the `/v1/ready` response shape, histogram buckets (5 ms to 10 s)
   and two missing outbox dead-letter metrics. Details are under "Task 3 results".
   **Gap:** `docs/architecture.md` sections 8-11 (rate limiting, per-subscription limits, retention, admin) and the Docker
   details in `docs/deployment.md` were not traced sentence by sentence, so the "every claim is backed" criterion stays open.
   Writing task 4 turned up one more error, now fixed (`f52f75d`): the SDK usage examples in `README.md` and
   `docs/architecture.md` did not match the real API.
4. ✅ **Interview guide** (`146233b`, `docs/interview-guide.md`). A 60-second pitch, one event traced end to end, and a
   section per component (outbox, idempotent ingestion, `SKIP LOCKED`, the delivery state machine, at-least-once and
   consumer idempotency, lease recovery, retry classification and backoff, replay, signing, SSRF, API keys, rate limits,
   throttle, retention, observability, sandbox, deployment), each with likely questions, answers and code pointers. It
   also has a self-test checklist, eleven limits to own, and the numbers that may and may not be quoted. Written from the
   code, not from the docs. **Not done:** the user has not yet practised from it, so the "can explain without notes"
   criterion stays open. Findings it records are under "Task 4 findings".
5. ✅ **Resume bullets** (`f86f6ba`, `docs/resume-bullets.md`). Three bullets and a one-line version, each tied to a
   feature, a measurement or a test count, plus a "do not claim" list (no "scalable", "exactly-once" or "highly
   available"; no deployed-instance performance figures; no "SSRF-proof"). The benchmark figures are local and the file
   says so. The file is public once pushed; see "Handling finals for GitHub" in the backlog.

**Why the load test is local only.** `scripts/load-test.ts` writes its project and key straight into Postgres, runs its own
webhook receiver on `127.0.0.1` and sets `ALLOW_LOCAL_WEBHOOKS`, so it cannot run against the public instance as written.
A remote mode would only measure the internet path to East Asia plus a throttled 1 GiB burstable VM, and would risk
the public demo. The live instance is covered by `pnpm smoke-test:remote` (28/28) instead. Do not quote local numbers as
deployed numbers.

**Task 1 results** (2026-11-12). Hardware: Intel i5-12450HX (6 CPUs visible to WSL2), 6.9 GB RAM, Node 24.19; API and
worker as plain Node processes, dev Postgres and Redis in Docker on the same machine. Default settings (batch 50, poll 1 s,
worker concurrency 10). Seven runs; ranges are min-max across runs. Scenario 2 is only about 0.4 s of traffic, so tail
percentiles rest on 200 requests.

| Scenario                                          | Result                                                                 |
| :------------------------------------------------ | :--------------------------------------------------------------------- |
| 1. Sequential ingestion, 50 requests              | 147-159 req/s, p50 5.5-5.8 ms, p99 22.7-29.6 ms                        |
| 2. Concurrent ingestion, 200 requests, 20 conc.   | 441-544 req/s, p50 32.5-34.6 ms, p95 71-139 ms, p99 96-181 ms          |
| 3. 50 parallel requests, same idempotency key     | 50 of 50 accepted with 202, 0 constraint violations (every run)        |
| 4. Delivery of 50 events (after 300 earlier ones) | 5.4-5.8 s before the fix; **0.80 s** after (three runs)                |
| 5. Endpoint fails once, then recovers             | delivered on the 2nd attempt in 1.0-1.8 s, including the backoff delay |

**What was found.** The old "9 deliveries/s" in scenario 4 was backlog, not delivery throughput. The outbox poller claimed
one batch per poll tick, a fixed ceiling of about 50 events/s per worker, while ingestion accepts 440-520 req/s, so the 300
events from scenarios 1-3 were still draining when scenario 4 started. Timeline from database timestamps: a 50-event
burst alone takes 1.0-1.2 s (about 0.8 s waiting for the next tick, then about 7 ms per record of serial fan-out); behind a
300-event backlog it took 6.4 s; with `OUTBOX_BATCH_SIZE=500` 1.5 s. The fix (`e0f9600`) re-polls immediately while
batches are full. The webhook calls themselves are not the limit: attempts finish within tens of milliseconds of being
enqueued.

**Quoting rules.** The scenario 4 figure the script now prints (about 62 deliveries/s) is a latency, not a throughput: it is
50 events over a drain time that is mostly the wait for the next poll tick. Quote "a 50-event burst, including a backlog,
is fully delivered in under a second" and the ingestion numbers. The sustained fan-out ceiling is estimated at about 150
events/s per worker (serial, 6-7 ms per record) but has **not** been measured after the fix.

**Task 3 results.** `OUTBOX_LOCK_TIMEOUT_MS` (default 30000) was defined but the poller ignored it and passed a fixed
`claimTimeoutMinutes: 5`; the setting is now gone and `docs/architecture.md` states the fixed 5 minutes.

**Finding: the default retry budget is about 15 seconds.** With `max_attempts` 5 and a 1 s base delay, the four waits have
ceilings of 1, 2, 4 and 8 s (full jitter, so about 7 s on average). A receiver that is down for minutes dead-letters its
deliveries and needs a replay; only a `Retry-After` header stretches a wait. The docs implied otherwise and now say this.
Be ready to explain it in interviews, and consider whether the defaults (or a per-subscription `maxAttempts`) should
change; that is a product decision, not made here.

**Task 4 findings** (read from the code while writing the guide; none are fixed, none block anything). They are product
or hardening decisions, so each needs approval before any change.

- **Recovery race (read, not reproduced).** `recoverAbandonedInFlightDeliveries` selects abandoned rows and then updates
  each by id with no status guard. One worker is protected by an `isRecovering` flag; two workers running the pass at once
  could both record a `WORKER_CRASHED` attempt and double-increment the count. A conditional update or `SKIP LOCKED` on the
  select would close it. Multi-replica operation is already documented as untested.
- **SSRF block list gaps (verified by running `isPrivateIp`).** `100.64.0.0/10` is not blocked, and the IPv6 check is
  prefix-based, so `::ffff:7f00:1` and `0:0:0:0:0:0:0:1` return `false`. Whether Node's resolver or sockets can present
  those forms was not tested. Parsing with `net.BlockList` would replace the string prefixes.
- **Signing secrets are stored as plaintext** in `subscriptions` because the worker signs with them directly. Encrypting
  them at rest needs a key the worker also holds.
- Already known and covered in the guide: the 15-second default retry budget, the fixed 5-minute outbox claim timeout,
  fixed-window rate limits that fail open, and offset pagination.

**Acceptance criteria**

- [x] README shows a working live link (or clearly marked fallback demo video) and real benchmark
      numbers with the hardware they were measured on. (`325b2e1`; the numbers are local, and the README says so.)
- [ ] Every claim in README and docs is backed by code, a test, or a measurement. (Task 3 covered the README, the
      overview, `observability.md` and the delivery semantics; the gap is listed under task 3.)
- [ ] The user can explain, without notes (study material is `docs/interview-guide.md`; only the user can tick this): the transactional outbox, `FOR UPDATE SKIP LOCKED`,
      idempotency via `ON CONFLICT`, at-least-once delivery and consumer idempotency, lease-based
      crash recovery, retry classification and backoff, DLQ replay, HMAC signing and verification,
      and SSRF protection.
- [x] 2–3 resume bullets are written, each tied to a verifiable feature or number. (`f86f6ba`)

### Backlog (not scheduled; do only after the user approves)

- [ ] **Make the dashboard responsive** (raised 2026-11-12: "the site is not responsive"). Check every page at
      phone and tablet widths, light and dark, and fix what breaks. Known so far: the landing diagram keeps a
      640 px minimum width and scrolls sideways, and the Endpoint C caption in it is clipped at the bottom of
      the SVG. Tables, the filter forms and the header nav have not been re-checked since the black-and-white
      re-theme. Verify with headless-browser screenshots, not only the unit tests.
- [ ] **Make the landing page look professional and modern** (raised 2026-11-12). A visual redesign of
      `Landing.tsx` and its components (hero, sign-in card, "How an event travels" diagram, "What you get"
      cards): stronger hierarchy and spacing, a more polished hero, consistent with the black-and-white theme
      and the Fraunces headings. Propose a design first and wait for approval, as for any frontend change.
- [ ] **Handling finals for GitHub** (raised 2026-11-12). Decide what belongs in the public repository before it is
      pushed or shared, and move the rest out with `.gitignore`. The user has further files to add to `.gitignore`
      and will supply the list. Already known to be personal or interview-only: `docs/resume-bullets.md` (committed in
      `f86f6ba`, so ignoring it later also needs `git rm --cached` and, if the repo was already pushed, a history
      decision) and possibly `docs/interview-guide.md`, which lists the project's own weaknesses. Check at the same
      time that no secrets, `.env` files, local dev data or throwaway notes are tracked. Propose the file list first and
      wait for approval.

---

## 5. Working Agreement

- No implementation starts until the user approves the phase (or individual task).
- Each task is a small, focused commit with a descriptive message.
- All quality gates (typecheck, lint, format, unit, integration tests) must pass before each commit.
- The user creates and owns all external accounts (Azure, GitHub secrets, and DuckDNS if used); no
  credentials are committed to the repository.
