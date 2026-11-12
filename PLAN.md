# EventForge — Completion & Deployment Plan

_Last updated: 2026-11-12 (Phase 3 in progress)_

**Completed-phase details (Phase 1 and 2):** `docs/plan-archive.md`
**Dashboard design:** `docs/dashboard-design.md` (Phase 2 reference)

This document tracks the work needed to take EventForge from a working codebase to a publicly
deployed, portfolio-ready project. Each phase begins only after explicit approval.

**Status:** Phases 1 and 2 are **complete and committed** (2026-11-12). Phase 3 (free deployment) is **in progress**:
the Azure VM exists and accepts SSH; Caddy and the GHCR image pipeline are committed; the first real deploy is next.

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

**Status: 🔄 In progress (started 2026-11-12).**

**Environment (done by the user):** Azure for Students account; VM `eventforge-vm` created in East Asia
(Standard_B2ats_v2, Ubuntu 24.04, Standard SKU static public IP, NSG allows 22/80/443); SSH login verified. The private
key lives only in `~/.ssh` and is never committed or shared.

**Tasks**

| #   | Task                                                                                                                                                                                                                                                                  | Status            |
| :-- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------- |
| 1   | **Caddy** in `docker-compose.prod.yml` as the only public entry point (80/443, automatic certificate), API bound to `127.0.0.1`, `TRUST_PROXY_HOPS=1`. Tested locally behind Caddy: `smoke-test:remote` 28/28; a forged `X-Forwarded-For` is ignored.                 | ✅ `6947ff2`      |
| 2   | **Prebuilt images:** CI `publish-images` job pushes API and worker images to GHCR on `main`; compose pulls them (`pull` then `up -d --no-build`). Replaces the old "arm64 builds" task: the VM is x64.                                                                | ✅ `a895809`      |
| 3   | **Memory limits for 1 GiB:** measure idle and light-load memory of each service, then set per-service limits and any Postgres/Node tuning needed so one service cannot starve the rest.                                                                               | ⏳ Next           |
| 4   | **`docs/deploy-azure-student.md`:** VM and NSG recap, 2 GB swap, Docker install, `.env.production` (generate secrets on the VM), first deploy, seeding the demo project and sandbox, backups, stopping/deallocating the VM to save credit, checking remaining credit. | ⏳ Not started    |
| 5   | **First deploy and verification** on the VM against every acceptance criterion below (needs the commits pushed, CI green, and both GHCR packages public).                                                                                                             | ⏳ Not started    |
| 6   | **Fallback doc:** run locally and expose with Tailscale Funnel or a Cloudflare quick tunnel, for when the Azure credit ends.                                                                                                                                          | ⏳ Not started    |
| 7   | **Optional CD:** after a green CI run on `main`, a workflow deploys to the VM over SSH (`pull` + `up -d --no-build`). Only after the manual deploy works.                                                                                                             | ⏳ Optional, last |
| 8   | **Plan and docs wording:** archive the Phase 3 details, refresh baselines, and correct any docs that still mention Oracle or arm64.                                                                                                                                   | ⏳ End of phase   |

**What you need to do (user steps)**

1. **Push** the Phase 3 commits to `main` on GitHub and wait for CI to go green (this first run publishes the images).
2. **Make both GHCR packages public** if they are private: GitHub profile, Packages, `eventforge-api` and
   `eventforge-worker`, Package settings, Change visibility. Otherwise the VM cannot pull them.
3. **At first deploy** (task 5), on the VM: clone the repo (or copy `docker-compose.prod.yml` and `deploy/`), create
   `.env.production` with generated secrets (`openssl rand -hex 24`), and run the compose commands from the guide. Never
   paste secrets into chat or commit them.
4. **Keep an eye on the Azure credit** (Cost Management + Billing) and stop or deallocate the VM when the demo is not
   needed.
5. **Only if we do CD (task 7):** add `SSH_HOST`, `SSH_USER` and `SSH_KEY` as GitHub Actions secrets, using a dedicated
   deploy key rather than your personal one.

**Acceptance criteria**

- [ ] Only ports 80/443 (and SSH) are reachable on the VM; Postgres, Redis, the worker, and `/metrics` without its token
      are not.
- [ ] `https://40-81-24-8.sslip.io/v1/health` returns `200` with a valid certificate.
- [ ] `https://40-81-24-8.sslip.io/dashboard` loads and the sandbox flow works on the live server.
- [ ] `pnpm smoke-test:remote` passes against the public URL.
- [ ] The stack fits in 1 GiB: no out-of-memory kills across the smoke test and a sandbox session (checked with
      `docker stats` and `dmesg`).
- [ ] Stack recovers automatically after a VM reboot (`restart: unless-stopped`, volumes persist, certificate kept).
- [ ] Following `docs/deploy-azure-student.md` from scratch produces a working deployment.
- [ ] Out-of-pocket cost is $0: no payment method attached, and the credit's burn rate and expected end date are
      recorded in the guide.
- [ ] (If CD is done) a push to `main` that passes CI redeploys the server without manual steps.

**Risks and notes**

- The credit is finite (about 6 months at this size). When it ends the VM stops; the fallback path keeps the demo
  available.
- 1 GiB RAM is tight. If it proves too small, resize to B2als_v2 (4 GiB, ~$38/month, about 2 months of credit) in the
  portal. Do this temporarily for the Phase 4 load test, which would otherwise throttle the burstable CPU.
- sslip.io is shared, so Let's Encrypt's per-domain certificate limit can be hit by other users. Caddy falls back to
  another CA; if both fail, switch to DuckDNS.
- The first `docker compose pull` fails if the GHCR packages are still private.

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
