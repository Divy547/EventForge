# EventForge — Resume Bullets

Draft bullets for a resume or portfolio. Each figure comes from the local load test, the test suite or the deployed stack;
the evidence is in `docs/interview-guide.md` (sections 15 and 16) and `PLAN.md` ("Task 1 results"). The benchmark numbers
were measured on one laptop with PostgreSQL and Redis on the same machine (i5-12450HX, 6.9 GB RAM, Node 24), not on the
deployed instance.

## Three bullets

1. Built **EventForge**, a multi-tenant webhook delivery service (TypeScript, NestJS, PostgreSQL, Redis/BullMQ). It uses a
   transactional outbox so an accepted event is committed with its publish record in one transaction, and
   `FOR UPDATE SKIP LOCKED` so workers can share the queue without claiming the same row. Delivery is at-least-once, with
   jittered exponential backoff, retry classification, a dead-letter queue with replay, and lease-based recovery of
   crashed workers, including after a full Redis loss.
2. Load-tested ingestion locally (441-544 req/s at 20 concurrent clients, p99 under 181 ms). The test showed backlog
   draining at only one batch per poll tick, which capped fan-out at about 50 events/s. I fixed it with a drain loop,
   cutting delivery of a 50-event burst queued behind 300 earlier events from about 5.5 s to 0.8 s. 50 parallel requests
   with the same idempotency key all succeeded with 0 constraint violations, using `ON CONFLICT DO NOTHING`.
3. Added HMAC-SHA256 signed webhooks with timestamp replay protection and an SDK for receivers, plus SSRF defences checked
   at subscription creation and again at connection time. Wrote 208 unit and 91 integration tests (real PostgreSQL and
   Redis) and a CI pipeline that publishes images to GHCR and deploys over SSH to a live Azure VM behind Caddy with
   automatic HTTPS. A React dashboard and public sandbox let a visitor try the system.

If a bullet has no room for "(local benchmark)", drop the req/s figure from bullet 2 and keep the 5.5 s to 0.8 s result,
which is a before and after on the same machine.

## Short version

Built a webhook delivery service (NestJS, PostgreSQL, Redis) with a transactional outbox, at-least-once delivery,
retries, dead-letter replay and HMAC signing. Fixed a backlog bottleneck found in load testing (5.5 s to 0.8 s for a
50-event burst). 299 tests; deployed live on Azure.

## Do not claim

- "High-throughput", "scalable", "exactly-once", "zero message loss" or "highly available". The numbers are local and
  single-instance, and replicas were never load-tested.
- Any performance figure for the deployed instance. The load test only ran locally.
- "SSRF-proof". The block list has known gaps (carrier-grade NAT, some IPv6 spellings; see `PLAN.md`, "Task 4 findings").
- "Distributed tracing". The code only propagates `traceparent`; no spans are exported.
