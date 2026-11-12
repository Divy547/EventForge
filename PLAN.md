# EventForge — Completion & Deployment Plan

_Last updated: 2026-11-12_

**Completed-phase details (Phase 1 and 2):** `docs/plan-archive.md`
**Dashboard design:** `docs/dashboard-design.md` (Phase 2 reference)

This document tracks the work needed to take EventForge from a working codebase to a publicly
deployed, portfolio-ready project. Each phase begins only after explicit approval.

**Status:** Phases 1 and 2 are **complete and committed** (2026-11-12). Phase 3 (free deployment) is **not started and
awaits your approval**.

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
