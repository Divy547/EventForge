# Deploying EventForge on an Azure for Students VM

This guide takes the production Compose stack (`docker-compose.prod.yml`) from an empty Ubuntu VM to a public HTTPS
deployment at zero out-of-pocket cost. It is the runbook for the instance at `https://40-81-24-8.sslip.io`; replace
that hostname and IP with your own.

> **Status:** written before the first deploy and verified step by step during Phase 3, task 5. If a command here
> turns out to be wrong, fix the guide in the same commit as the fix.

For what each service does and for operations that are not specific to this host (migrations, metrics, DLQ triage),
see [deployment.md](deployment.md).

---

## 1. What you are building

| Item        | Value                                                                                                                                |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| VM          | `eventforge-vm`, Ubuntu 24.04 LTS, x64, **Standard_B2ats_v2** (2 vCPU burstable, **1 GiB RAM**), East Asia                           |
| Network     | Standard SKU static public IP; network security group (NSG) allows inbound TCP 22, 80 and 443 only                                   |
| Hostname    | `<ip-with-dashes>.sslip.io`, which resolves to the IP with no DNS setup; Caddy gets a Let's Encrypt certificate for it               |
| Images      | Pulled from GHCR (`ghcr.io/divy547/eventforge-api` and `-worker`), built by CI. **Never build on the VM**: 1 GiB is too small        |
| Memory plan | Per-container limits add up to ~670 MiB (api 224, worker 192, postgres 160, redis 48, caddy 48); the rest is the OS, Docker and swap |

The VM, static IP and NSG rules are created in the Azure portal by the account owner. Recap of what must exist:

- VM size `Standard_B2ats_v2` in East Asia. It was the only size and region the student subscription allowed; most
  D-series sizes and other regions fail with `NotAvailableForSubscription`.
- A **Standard SKU, static** public IP (Basic SKU IPs are being retired and a dynamic IP would change the hostname).
- Inbound rules for **22, 80 and 443** only. Nothing else may be open: Postgres, Redis, the worker and the API's own
  port are not reachable from outside by design.
- SSH key authentication. Keep the private key in `~/.ssh` on your machine; never commit it or paste it anywhere.

---

## 2. Prepare the VM

SSH in (adjust user and key path to what you chose at creation):

```bash
ssh -i ~/.ssh/<your-key> azureuser@40.81.24.8
```

### 2.1 Add 2 GB of swap

1 GiB of RAM is enough for the stack's steady state, but not for image pulls, migrations and a burst of traffic at the
same time. Swap turns an out-of-memory kill into a brief slowdown.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Prefer RAM; use swap only under pressure
echo 'vm.swappiness=20' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system

free -h        # Swap: 2.0Gi
```

Azure VMs have a small local temp disk, but the OS disk is where `/swapfile` goes; do not put swap on `/mnt`, which
Azure can wipe.

### 2.2 Install Docker Engine and the Compose plugin

Use Docker's official apt repository (the `docker.io` package in Ubuntu's repository is older):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Run docker without sudo (log out and back in afterwards)
sudo usermod -aG docker "$USER"
```

Reconnect, then check:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

Docker starts on boot (`systemctl is-enabled docker` prints `enabled`), which together with `restart: unless-stopped`
in the Compose file is what brings the stack back after a reboot.

### 2.3 Keep the OS patched

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # answer Yes
```

---

## 3. Get the deployment files

The VM needs only `docker-compose.prod.yml`, `deploy/Caddyfile` and `.env.production`. Cloning the repository is the
simplest way to get the first two and to pick up later changes with `git pull`:

```bash
git clone https://github.com/Divy547/EventForge.git
cd EventForge
```

The repository is public, so no credentials are needed. The source tree on the VM is never built; it is just the
carrier for the Compose and Caddy files.

Check that the images can be pulled without logging in (both GHCR packages must be public):

```bash
docker pull ghcr.io/divy547/eventforge-api:latest
docker pull ghcr.io/divy547/eventforge-worker:latest
```

A `denied` or `unauthorized` error means a package is still private (GitHub: profile, Packages, the package, Package
settings, Change visibility).

---

## 4. Configure `.env.production`

Create the file **on the VM** and generate the secrets there, so they never pass through chat, your clipboard or git:

```bash
cp .env.production.example .env.production
chmod 600 .env.production

# Generate secrets in place (hex avoids URL-escaping problems in the database connection string)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.production
sed -i "s|^METRICS_TOKEN=.*|METRICS_TOKEN=$(openssl rand -hex 24)|" .env.production
```

Then edit the remaining values with `nano .env.production`:

| Variable               | Value for this deployment                                                                                            |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `SITE_ADDRESS`         | `40-81-24-8.sslip.io` (your IP with dashes). **Required**: Compose refuses to start without it.                      |
| `SANDBOX_ENABLED`      | `true` for the public demo (decided for this instance); keep `SANDBOX_RECEIVER_URL=http://api:3000/sandbox/receiver` |
| `CORS_ALLOWED_ORIGINS` | Leave empty. The dashboard is served from the same origin as the API, so no cross-origin access is needed.           |
| `EVENTFORGE_TAG`       | Leave unset (`latest`). Set `sha-<short commit>` to pin a release or to roll back.                                   |
| Memory limits          | Leave the defaults; they are sized for 1 GiB. Only change them if you resize the VM (section 9).                     |

`DATABASE_URL` in the template is unused by Compose, which builds its own from `POSTGRES_PASSWORD`; leave it or delete
the line. Never set `ALLOW_LOCAL_WEBHOOKS=true`: the API refuses to start in production with it.

Keep a copy of `.env.production` somewhere private off the VM (a password manager). Losing `POSTGRES_PASSWORD` is
survivable only until the first restart of an existing database volume, because Postgres keeps the password it was
first initialised with.

---

## 5. First deploy

```bash
alias dc='docker compose --env-file .env.production -f docker-compose.prod.yml'

dc pull
dc up -d --no-build
dc ps
```

Start-up order is enforced by Compose: Postgres and Redis become healthy, the one-off `migrate` job applies the schema
and exits, then the API and worker start, then Caddy once the API is healthy. The first start also requests the
certificate, which needs ports 80 and 443 reachable from the internet.

Follow the logs while it settles:

```bash
dc logs -f caddy api      # Ctrl-C to stop following
```

Look for Caddy logging `certificate obtained successfully`. Then from your own machine:

```bash
curl -i https://40-81-24-8.sslip.io/v1/health          # 200, valid certificate
curl -i https://40-81-24-8.sslip.io/v1/ready           # 200, database and redis "up"
curl -i https://40-81-24-8.sslip.io/v1/metrics         # 401 without the token
```

Open `https://40-81-24-8.sslip.io/dashboard` in a browser.

**If the certificate is not issued:** check that the NSG allows 80 and 443, that `SITE_ADDRESS` matches the hostname
exactly, and read `dc logs caddy`. sslip.io is a shared domain, so Let's Encrypt's per-domain limit can be hit by other
users; Caddy then falls back to another CA. If both fail, switch to a DuckDNS subdomain (a free account owned by you)
and set `SITE_ADDRESS` to it. Do not delete the `eventforge_prod_caddy_data` volume while troubleshooting: it holds the
certificates, and re-requesting them counts against the CA's limits.

---

## 6. Seed the demo and the sandbox

### 6.1 Sandbox

Nothing to seed. With `SANDBOX_ENABLED=true` the API creates the shared `sandbox` project the first time someone
clicks "Try the live sandbox" on the dashboard, and hands out one-hour keys. The worker is allowed to call the built-in
demo receiver (`SANDBOX_RECEIVER_URL`); every other target still passes the SSRF checks.

### 6.2 A project and key of your own (optional)

For your own testing, `curl` examples and the load test, create a project and a key with the admin CLI inside the
running API container:

```bash
dc exec api node packages/database/dist/scripts/admin.js project:create --name "Demo" --slug demo
dc exec api node packages/database/dist/scripts/admin.js key:create --project demo --name "me"
```

The raw key is printed **once**; store it in a password manager. Revoke or rotate keys with `key:revoke` and
`key:rotate` (see `admin.js --help`).

### 6.3 Verify the whole stack

Run the smoke test from a checkout on your own machine against the public URL (needs a key from 6.2):

```bash
API_URL=https://40-81-24-8.sslip.io SMOKE_API_KEY=<key> METRICS_TOKEN=<token> pnpm smoke-test:remote
```

Note that `METRICS_TOKEN` is the value from the VM's `.env.production`. The smoke test is HTTP-only: it does not prove
webhook delivery to an external URL, but the dashboard's sandbox flow does (it delivers to the demo receiver).

---

## 7. Check that it fits in 1 GiB

During and after the smoke test and a sandbox session:

```bash
docker stats --no-stream        # per-container memory vs. limit
free -h                         # RAM and swap in use
sudo dmesg -T | grep -i -E 'out of memory|oom|killed process'   # should print nothing
dc ps                           # every service Up, none restarting
```

Healthy looks like total container memory well under 700 MiB and little or no swap in use. A container that shows
`(OOMKilled)` in `docker inspect <name> --format '{{.State.OOMKilled}}'` has hit its limit; raise that service's limit
or resize the VM (section 9).

Reboot test (the stack must come back on its own, with data and certificate intact):

```bash
sudo reboot
# wait a minute, reconnect
dc ps
curl -i https://40-81-24-8.sslip.io/v1/ready
```

---

## 8. Day-to-day operations

### Deploy a new version

CI publishes images to GHCR on every push to `main` that passes all checks. On the VM:

```bash
cd ~/EventForge
git pull                       # only needed when docker-compose.prod.yml or deploy/ changed
dc pull
dc up -d --no-build            # migrations run first; a failed migration stops the deploy
docker image prune -f          # reclaim disk from old layers
```

### Roll back

Set `EVENTFORGE_TAG=sha-<short commit of a good build>` in `.env.production`, then `dc pull && dc up -d --no-build`.
Schema migrations are not reversed automatically, so roll back across a migration only if the older code tolerates the
newer schema.

### Logs and health

```bash
dc logs --tail 100 -f api worker
dc exec redis redis-cli ping
curl -H "Authorization: Bearer $METRICS_TOKEN" https://40-81-24-8.sslip.io/v1/metrics | head
```

### Backups

The data that matters is in the Postgres volume. Take a custom-format dump (the same commands as
[deployment.md](deployment.md#postgresql-backup-procedure)) and copy it off the VM:

```bash
mkdir -p ~/backups
dc exec -T postgres pg_dump -U postgres -d eventforge -Fc > ~/backups/eventforge_$(date +%Y%m%d_%H%M%S).dump
find ~/backups -name '*.dump' -mtime +14 -delete      # keep two weeks
```

From your own machine:

```bash
scp -i ~/.ssh/<your-key> 'azureuser@40.81.24.8:backups/*.dump' ./eventforge-backups/
```

For a demo instance a weekly manual dump is enough; the data is regenerable. To automate it, add the first two commands
(with absolute paths) to `crontab -e`. Restore with the `pg_restore` procedure in deployment.md.

---

## 9. Cost: staying at $0

The student credit is the only thing paying for this. **No payment method is attached to the subscription**, so when
the credit runs out the resources stop instead of billing you.

| What                                  | Approximate cost                                                                                                      |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------- |
| VM `Standard_B2ats_v2`, running 24/7  | ~$9.56 / month (the figure shown at creation)                                                                         |
| OS disk and Standard static public IP | Small, but **billed even while the VM is deallocated** (record the exact figure from Cost Management at first deploy) |
| Credit                                | About $100, so roughly 6 months of continuous running                                                                 |

_Burn rate and expected end date: to be recorded here from Cost Management after the first week of running._

### Check the remaining credit

Azure portal: **Cost Management + Billing**, then your Azure for Students subscription, where the remaining credit and
its expiry are shown. Open **Cost analysis** to see the daily burn by resource. Check it when you deploy and then about
once a month. Set a budget alert (Cost Management, Budgets) at roughly 50% and 80% of the credit; alerts are free.

### Stop paying for compute when the demo is not needed

**Stop the VM from the portal or the CLI so it is _deallocated_.** Shutting down from inside the OS (`sudo shutdown`)
leaves the VM allocated and still billing for compute.

```bash
az vm deallocate --resource-group <rg> --name eventforge-vm     # compute billing stops
az vm start      --resource-group <rg> --name eventforge-vm
```

After starting again the Compose stack comes back by itself, and the public IP is unchanged because it is static. The
certificate is kept in its volume.

### Resize if 1 GiB is not enough

In the portal: VM, **Size**, choose `Standard_B2als_v2` (4 GiB, about $38/month, so roughly 2 months of credit). Resizing
restarts the VM. Raise the memory limits through the `*_MEM_LIMIT` and `*_NODE_HEAP_MB` variables in `.env.production`
(the heap must stay below the container limit). Do this temporarily for the Phase 4 load test, which would otherwise
exhaust the burstable CPU credits, and resize back afterwards.

### When the credit ends

The VM stops and nothing is charged. The demo then lives on the fallback path (run locally and expose it with Tailscale
Funnel or a Cloudflare quick tunnel); see the fallback guide once it exists, and keep a recorded demo in the README.

---

## 10. Troubleshooting

| Symptom                                      | Check                                                                                                         |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `dc pull` says `denied`                      | The GHCR package is private; make it public.                                                                  |
| `dc up` says `POSTGRES_PASSWORD must be set` | `.env.production` missing, wrong path, or you forgot `--env-file` (use the `dc` alias).                       |
| `SITE_ADDRESS must be set`                   | Same, for the hostname.                                                                                       |
| HTTPS fails, HTTP works                      | Certificate not issued yet: `dc logs caddy`; confirm NSG ports 80 and 443.                                    |
| API container restarts repeatedly            | `dc logs api`. A wrong `DATABASE_URL` or `METRICS_TOKEN` shorter than 16 characters fails validation at boot. |
| A container is killed or `Exited (137)`      | Out of memory: `docker inspect` shows `OOMKilled`. Raise its limit or resize the VM.                          |
| Everything is slow after a burst of traffic  | Burstable CPU credits ran out (B-series). It recovers on its own; resize for sustained load tests.            |
| Sandbox returns 404                          | `SANDBOX_ENABLED` is not `true` in `.env.production`; recreate with `dc up -d --no-build`.                    |
