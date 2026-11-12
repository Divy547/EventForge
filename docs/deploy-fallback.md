# Fallback: run EventForge on your own machine and expose it with a tunnel

The Azure for Students deployment ([deploy-azure-student.md](deploy-azure-student.md)) runs on a credit of roughly six
months. When it ends the VM stops and `https://40-81-24-8.sslip.io` goes dark. This guide keeps the demo reachable at
$0 by running the same production Compose stack on your own computer and publishing it through a tunnel.

> **Status:** section 2 (the local stack) was run and verified on 2026-11-12: all five services healthy and
> `pnpm smoke-test:remote` 28/28 against `http://localhost`. The tunnel commands in sections 3 and 4 were **not run**
> (no Tailscale or Cloudflare account was involved); they follow the vendors' current documentation, linked below. If
> a command turns out to be wrong, fix this guide in the same commit as the fix.

The demo is only up while your computer is on, awake and online. That is the price of not paying for hosting. For
everything else, keep a recorded demo in the README (Phase 4).

---

## 1. Choose a tunnel

|             | Tailscale Funnel                                                                   | Cloudflare quick tunnel                                                                    |
| :---------- | :--------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| URL         | Stable: `https://<machine>.<tailnet>.ts.net`                                       | **Changes every time** `cloudflared` restarts (`https://<random-words>.trycloudflare.com`) |
| Account     | Free Tailscale account                                                             | None                                                                                       |
| README link | Yes, it stays valid                                                                | No, it would go stale; use only for ad-hoc demos                                           |
| Limits      | Public ports 443, 8443 or 10000 only; Tailscale applies bandwidth limits to Funnel | Testing use only, no uptime guarantee, 200 concurrent requests, no Server-Sent Events      |
| Setup       | Install, log in, allow Funnel in the admin console                                 | Install one binary                                                                         |

**Recommendation: Tailscale Funnel**, because a stable URL is what makes a link in a README or on a CV worth
anything. Use the quick tunnel to show the project to someone right now.

Sources: [`tailscale funnel` command](https://tailscale.com/docs/reference/tailscale-cli/funnel),
[Cloudflare quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

---

## 2. Run the stack locally

The tunnel needs a plain-HTTP origin on your machine. Caddy supports that with `SITE_ADDRESS=:80`: it then serves HTTP
only and requests no certificate; the tunnel provides the public HTTPS. Everything else is the production stack
unchanged.

Prerequisites: Docker with the Compose plugin, a clone of the repository, and **port 80 free** on the machine (the
Compose file publishes Caddy on 80 and 443; stop any other web server first). The images come from GHCR, so nothing is
built.

```bash
git clone https://github.com/Divy547/EventForge.git
cd EventForge

cp .env.production.example .env.production
chmod 600 .env.production
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.production
sed -i "s|^METRICS_TOKEN=.*|METRICS_TOKEN=$(openssl rand -hex 24)|" .env.production
sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=:80|" .env.production
sed -i "s|^SANDBOX_ENABLED=.*|SANDBOX_ENABLED=true|" .env.production

alias dc='docker compose --env-file .env.production -f docker-compose.prod.yml'
dc pull
dc up -d --no-build
dc ps -a
```

On macOS use `sed -i ''` instead of `sed -i`. Expect `postgres`, `redis`, `api` and `worker` to be `Up (healthy)`,
`caddy` to be `Up`, and `migrate` to show `Exited (0)`. Then:

```bash
curl -i http://localhost/v1/health          # 200
curl -i http://localhost/v1/ready           # 200, database and redis "up"
```

Open `http://localhost/dashboard` and try the sandbox. The remaining steps of the Azure guide apply unchanged:
[sandbox and your own project/key](deploy-azure-student.md#6-seed-the-demo-and-the-sandbox), and
[backups](deploy-azure-student.md#backups). If you carry data over from the VM, restore a dump with the `pg_restore`
procedure in [deployment.md](deployment.md#postgresql-backup-procedure).

The services have `restart: unless-stopped`, so they come back whenever Docker does. They do not start on their own if
Docker is not set to start at login or boot.

### Verify it

From a checkout of the repository (needs Node and `pnpm install`), with the admin CLI reached through Docker:

```bash
export METRICS_TOKEN=$(grep '^METRICS_TOKEN=' .env.production | cut -d= -f2)
export ADMIN_CMD="docker exec -i eventforge-prod-api node packages/database/dist/scripts/admin.js"
API_URL=http://localhost pnpm smoke-test:remote
```

Expect all 28 checks to pass. Run it again later with `API_URL` set to the public tunnel URL to prove the tunnel path
too (the admin CLI still runs locally, so `ADMIN_CMD` stays as above).

---

## 3. Option A: Tailscale Funnel (stable URL)

One-time setup:

1. Create a free account at tailscale.com and install Tailscale on the machine that runs the stack
   ([downloads](https://tailscale.com/download)). Log in (`sudo tailscale up` on Linux).
2. In the Tailscale admin console, enable **HTTPS certificates** (DNS page) and allow **Funnel** for this machine. If
   either is missing, `tailscale funnel` prints a link that enables it.

> **Running Docker inside WSL2?** Untested here. The simplest route is to install Tailscale on the Windows side and
> point Funnel at `localhost:80`, which Windows forwards into WSL2; installing it inside WSL2 also works but needs
> WSL2's networking and `systemd` set up for the Tailscale daemon.

Publish the local stack:

```bash
tailscale funnel --bg 80              # forwards https://<machine>.<tailnet>.ts.net/ to http://127.0.0.1:80
tailscale funnel status               # shows the public URL
```

`--bg` keeps it running in the background and across reboots. Stop publishing with `tailscale funnel reset`. Check it
from a device that is **not** on your tailnet (a phone on mobile data):

```bash
curl -i https://<machine>.<tailnet>.ts.net/v1/health
```

Tailscale terminates TLS and Caddy stays on plain HTTP behind it, so no certificate setup is needed on your side.

---

## 4. Option B: Cloudflare quick tunnel (no account, URL changes)

Install `cloudflared` from [Cloudflare's getting-started page](https://developers.cloudflare.com/tunnel/get-started/),
then:

```bash
cloudflared tunnel --url http://localhost:80
```

It prints a `https://<random-words>.trycloudflare.com` address. Share that for as long as the command keeps running;
Ctrl-C ends the tunnel and the address is gone for good. Run it inside `tmux` or `screen`, or under a service manager,
if it should survive closing the terminal.

Cloudflare documents that a quick tunnel does not work if `~/.cloudflared/config.yaml` exists; rename that file while
using one.

---

## 5. Limits to know about

- **Every visitor looks like one client.** The tunnel connects to Caddy from your own machine, so the API sees a single
  client address and per-IP limits are shared by all visitors: the sandbox allows only `SANDBOX_SESSIONS_PER_HOUR`
  (default 10) new sessions per hour **in total**, and the 2,400 requests/minute IP limit is shared too. For a public
  demo raise `SANDBOX_SESSIONS_PER_HOUR` and `SANDBOX_WRITES_PER_HOUR` in `.env.production`, then
  `dc up -d --no-build`. Visitors cannot spoof their address: Caddy ignores a client-supplied `X-Forwarded-For`.
- **The data lives on your computer.** Backups (Azure guide, section 8) matter more here, and the sandbox project is
  shared by everyone as before.
- **Your machine is the server.** It is exposed to the internet through the tunnel only: no router ports are opened,
  and Postgres, Redis and the worker are not published. Keep `ALLOW_LOCAL_WEBHOOKS=false` (the default) so the worker
  cannot be pointed at your home network.
- **Resources.** The memory limits are sized for a 1 GiB VM and are more than enough on a laptop; steady state is
  roughly 200 MiB.
- **No `sslip.io` or certificates are involved**, so `CORS_ALLOWED_ORIGINS` stays empty (the dashboard is same-origin)
  and Caddy's certificate volumes stay unused.

---

## 6. Switching back and stopping

```bash
tailscale funnel reset                # stop publishing (or Ctrl-C the cloudflared command)
dc down                               # stop the stack, keep the data
# dc down -v would also delete the database, certificates and queue: only when you mean it
```

When the README link changes (a new Funnel hostname, or a new Azure instance), update it in the same commit as the
documentation.
