# EventForge — Completion & Deployment Plan

_Last updated: 2026-11-12 (Phase 3 nearly complete; only the credit burn rate remains, plus a green CI run for the flaky-test fix)_

**Completed-phase details (Phase 1 and 2):** `docs/plan-archive.md`
**Dashboard design:** `docs/dashboard-design.md` (Phase 2 reference)

This document tracks the work needed to take EventForge from a working codebase to a publicly
deployed, portfolio-ready project. Each phase begins only after explicit approval.

**Status:** Phases 1 and 2 are **complete and committed** (2026-11-12). Phase 3 (free deployment) is **nearly complete**:
the stack is live at `https://40-81-24-8.sslip.io`, the fallback doc is written, automatic deploys from CI work, and the
Phase 3 details are archived (task 8). **Remaining:** record the credit burn rate (waits on Azure Cost Management data) and
see the flaky-test fix (`fcbc8df`) pass in CI.

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

## 3. Baseline after Phase 2 (2026-11-12)

| Check                                     | Result                                                                                            |
| :---------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`, `lint`, `format:check`  | ✅ Clean                                                                                          |
| `pnpm test:unit`                          | ✅ 200/200 (API 74, worker 31, dashboard 95)                                                      |
| `pnpm test:integration` (real PG + Redis) | ✅ 91/91 (API 76, worker 15)                                                                      |
| `pnpm smoke-test:remote`                  | ✅ 25/25 on the built API (dev config; `/metrics` check expected to fail without `METRICS_TOKEN`) |

The Phase 1 baseline is in `docs/plan-archive.md`.

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
| 8    | this commit                     | Phase 3 details moved to the archive; no Oracle or arm64 mentions remain in the docs   |

Also: `fcbc8df` runs package test suites one at a time (a flaky API test shared a database with the worker); `1a74ebf`
stops newer pushes from cancelling runs on `main`.

**Still open**

- [ ] **Credit burn rate and expected end date** recorded in `docs/deploy-azure-student.md` (waits on the first Azure Cost
      Management data). This is the only unchecked Phase 3 acceptance criterion. A budget alert exists (8,500 INR, alerts at
      50% and 80%) and no payment method is attached.
- [ ] **Flaky-test fix seen green in CI.** The commits after `2b49e82` (`37c8d91`, `fcbc8df`, `b1dab8b` and this one) are
      not pushed yet; pushing redeploys the server because CD is on.
- [ ] **Baselines not refreshed.** Section 3 still shows the Phase 2 numbers; the gates were not re-run in task 8.

**Notes that still matter**

- Usable RAM on the VM is about 836 MiB. If Caddy is OOM-killed, raise `CADDY_MEM_LIMIT` to 64m.
- The credit lasts about 6 months; when it ends the VM stops and the fallback guide keeps the demo available.
- Every push to `main` that passes CI redeploys the server while the `DEPLOY_URL` variable exists (delete it to turn CD off).
  A deploy that does not become healthy fails the job but does not roll back.
- For the Phase 4 load test, resize the VM temporarily to B2als_v2 so the burstable CPU is not throttled.

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
- The user creates and owns all external accounts (Azure, GitHub secrets, and DuckDNS if used); no
  credentials are committed to the repository.
