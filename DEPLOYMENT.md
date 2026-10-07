# Scholario Ops — Deployment

One small Ubuntu VPS runs PostgreSQL, the Node app (PM2) and nginx (HTTPS).
**Do not install it on the ICT servers.** The Ops server has to stay up when they go down.

```
Browser ──HTTPS──▶ nginx :443 ──▶ Node 127.0.0.1:4000 (PM2 "scholario-ops") ──▶ PostgreSQL (schema "ops")
ICT VPS agents ──HTTPS, outbound only──▶ nginx ──▶ /api/v1/agent/ingest
```

---

## 0. Deploying onto a server that already runs other applications

The target server already runs other PM2 apps (**a11y-backend**, **ascend-demo-api**, **ascend-demo-web**). Scholario Ops must sit next to them **without touching them**:

| Item | Scholario Ops uses | Never |
|---|---|---|
| Directory | `/var/www/scholario-ops` (create it; don't reuse another app's folder) | write into other apps' directories |
| PM2 app | `scholario-ops` only (`pm2 start ecosystem.config.js --env production`) | `pm2 delete all`, `pm2 restart all`, `pm2 kill`, `pm2 update` without reason |
| Port | a **free localhost port chosen at deploy time**, set as `PORT` in `ecosystem.config.js` → `env_production` (default 4000) and in the nginx `proxy_pass` lines | a port another app already uses |
| nginx | a **new** file `/etc/nginx/sites-available/scholario-ops` for its own subdomain | editing or replacing existing server blocks or `default` |
| Domain | its own subdomain, e.g. `ops.yourdomain.com` | sharing another app's server_name |
| Database | its own PostgreSQL database + user (`scholario_ops`) | other apps' databases |
| Logs | `/var/www/scholario-ops/logs` | — |

Check before choosing the port and installing:

```bash
pm2 list                                  # note the existing apps — they must still be "online" afterwards
ss -ltnp | grep -E ':(3[0-9]{3}|4[0-9]{3}|5[0-9]{3})\b'   # ports already in use
ls /etc/nginx/sites-enabled/              # existing server blocks — leave them as they are
node -v                                   # existing Node version (Scholario Ops needs 20+)
psql --version
```

If the port you picked is free (e.g. `4100`), set it in `ecosystem.config.js` (`env_production.PORT`) and replace `127.0.0.1:4000` in `nginx/scholario-ops.conf`.
Afterwards, `pm2 list` must show the original apps unchanged plus `scholario-ops`.

**Upgrading Node on a shared server:** if the server's Node is older than 20, don't upgrade it globally under running apps. Use `nvm` for the Scholario Ops user, or plan the upgrade with the owners of the other apps.

## 1. Requirements

| | |
|---|---|
| OS | Ubuntu 22.04 / 24.04 (any Linux with systemd works) |
| Size | 1–2 vCPU, 2 GB RAM, 20 GB disk |
| Node.js | 20 or newer (22 LTS recommended) |
| PostgreSQL | 14 or newer |
| nginx + certbot | reverse proxy and Let's Encrypt certificate |
| PM2 | process manager (`npm i -g pm2`) |
| DNS | an `A` record such as `ops.yourdomain.com` pointing to this VPS |
| Redis | **Not used.** Realtime updates use Server-Sent Events from the Node process, so no Redis is needed. |

```bash
apt update && apt -y upgrade
apt -y install nginx postgresql postgresql-contrib certbot python3-certbot-nginx git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt -y install nodejs
npm install -g pm2
```

## 2. Environment variables

Create `/var/www/scholario-ops/.env` from `.env.example` and run `chmod 600 .env`. **Never commit `.env`** (it is git-ignored).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | `postgresql://user:password@localhost:5432/scholario_ops`. The server refuses to start without it. |
| `DB_SCHEMA` | no (`ops`) | Schema holding all tables |
| `PUBLIC_URL` | **yes in production** | `https://ops.yourdomain.com`. Used by agent install commands and notification links. |
| `JWT_SECRET` | **yes in production** | 48+ random characters: `openssl rand -hex 48` |
| `PORT` / `HOST` | set by PM2 | `4000` / `127.0.0.1` (only nginx can reach Node) |
| `TRUST_PROXY` | no (`loopback`) | Trust nginx on the same host for client IPs |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | first start | Creates the first super-admin when the database has no users. If `ADMIN_PASSWORD` is empty or weak, a generated password is written to `DATA_DIR/initial-admin-password.txt` (mode 600), never to the log. |
| `CLOUDFLARE_API_TOKEN` | recommended | Read-only token: Account › Load Balancing: Monitors and Pools › Read, Zone › Load Balancers › Read, Zone › Zone › Read, with the application zone (e.g. `kodeit.digital`) included in **Zone Resources** (without it, routing / pool order shows "not readable"). It stays on the server. **A token that was ever pasted into chat, source code, a ticket or a log must be rolled** in Cloudflare before production. |
| `HOSTINGER_API_TOKEN` | optional | Hostinger VPS API (plan, CPU, RAM, disk, OS, state, region), read-only. `HOSTINGER_TIMEOUT_MS` (15000). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | optional | Email notification channels |
| `DEADMAN_HEARTBEAT_URL` | recommended | External heartbeat (e.g. healthchecks.io) that alerts you if this server dies |
| `DEPLOY_REPORT_TOKEN` | optional | Lets CI report deployments |
| `LOG_LEVEL` / `LOG_FORMAT` | no | `info` / JSON in production (`LOG_FORMAT=text` for plain text) |
| `DATA_DIR` | no (`./data`) | Holds only the generated session secret and first-admin password file |
| Thresholds | no | `BACKUP_MAX_AGE_HOURS` (26), `REPLICATION_MAX_LAG_SEC` (300), `SSL_EXPIRY_WARN_DAYS` (21), `ALERT_COOLDOWN_MIN` (15), `API_RATE_LIMIT_PER_MIN` (600). Applications can override backup age and replication lag per environment in Setup. |
| Tuning (defaults are fine) | no | `CLOUDFLARE_SYNC_INTERVAL_SEC`, `CLOUDFLARE_LB_SYNC_INTERVAL_SEC`, `HOSTINGER_SYNC_INTERVAL_SEC`, `TELEMETRY_STALE_THRESHOLD_SEC`, `METRICS_RETENTION_HOURS`, `CHECK_HISTORY_RETENTION_DAYS`, `AUDIT_RETENTION_ENTRIES`, `MONITOR_WORKER_CONCURRENCY`, `AGENT_MAX_CLOCK_SKEW_SEC`, `DR_LATENCY_THRESHOLD_MS`, `DEADMAN_INTERVAL_SEC`, `DEADMAN_TOLERANCE_SEC`, `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_SEC`, `CORS_ORIGINS` |

With `NODE_ENV=production` the server checks this at startup. A missing `DATABASE_URL` **stops** the start. Warnings are printed for:
- `PUBLIC_URL` missing or not https
- no `JWT_SECRET`
- `HOST=0.0.0.0`
- no Cloudflare token
- no dead-man URL

## 3. Database setup

```bash
sudo -u postgres psql <<'SQL'
CREATE USER scholario_ops WITH PASSWORD 'CHANGE-ME-long-random-password';
CREATE DATABASE scholario_ops OWNER scholario_ops;
SQL
```

- **Migrations** (`server/migrations/*.sql`, copied into `dist-server/migrations` by the build) run automatically at every start. Each one runs once and is recorded in `ops.schema_migrations`. You can also run them by hand with `npm run db:migrate`.
- **Retention:**
  - check results are kept `CHECK_HISTORY_RETENTION_DAYS` (90)
  - metrics `METRICS_RETENTION_HOURS` (48)
  - audit entries `AUDIT_RETENTION_ENTRIES` (5000)
  - hourly uptime aggregates 30 days

**Move your existing data** (ICT configuration, users, history) from your PC before the first start:

```powershell
# Windows PC
pg_dump --schema=ops --no-owner --no-privileges "postgresql://scholario_ops:<local-password>@localhost:5432/scholario_ops_dev" -f ops-export.sql
scp ops-export.sql root@<ops-vps-ip>:/tmp/
```
```bash
# Ops server
psql "postgresql://scholario_ops:CHANGE-ME-long-random-password@localhost:5432/scholario_ops" -f /tmp/ops-export.sql && rm /tmp/ops-export.sql
```

If you skip this, start empty and enter the servers and applications in **Setup & Connections**.

## 4. Redis setup

None. Scholario Ops does not use Redis. Don't set `REDIS_URL`; nothing reads it.

## 5. Build

```bash
mkdir -p /var/www && cd /var/www
git clone <your-repo-url> scholario-ops && cd scholario-ops
npm ci
npm run build        # dist/ (dashboard) + dist-server/server.js + dist-server/migrations
```

Optional full check (needs `DATABASE_URL`; tests use throw-away schemas and drop them): `npm run verify`.

## 6. PM2 start

```bash
cd /var/www/scholario-ops
pm2 start ecosystem.config.js --env production
pm2 logs scholario-ops --lines 50     # look for "ready — database loaded, monitoring started"
curl -s http://127.0.0.1:4000/api/health/ready
```

`ecosystem.config.js` only defines the app **`scholario-ops`**, with its own name, working directory and logs. It doesn't touch other PM2 apps. Manage it by name and **never use `pm2 delete all` / `pm2 restart all`** on a shared server.

## 7. PM2 startup on reboot

```bash
pm2 save
pm2 startup systemd      # run the command it prints (once)
```

## 8. nginx reverse proxy

```bash
cp nginx/scholario-ops.conf /etc/nginx/sites-available/scholario-ops
sed -i 's/ops.example.com/ops.yourdomain.com/g' /etc/nginx/sites-available/scholario-ops
ln -s /etc/nginx/sites-available/scholario-ops /etc/nginx/sites-enabled/
```

nginx passes everything to Node, which sets cache headers, CSP and other security headers. nginx adds HSTS. The realtime stream is unbuffered and excluded from the access log.

## 9. HTTPS

```bash
certbot certonly --nginx -d ops.yourdomain.com
nginx -t && systemctl reload nginx
```

If the domain is proxied through Cloudflare, set Cloudflare SSL mode to **Full (strict)**.
Firewall (you do this; the app never changes firewalls): `ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable`. Ports 4000 and 5432 must stay closed to the internet.

## 10. Health checks

| Endpoint | Meaning | Codes |
|---|---|---|
| `GET /api/health/live` (also `/health/live`) | **Liveness.** The Node process is running and serving HTTP. | 200 always while the process is up |
| `GET /api/health/ready` (also `/health/ready`) | **Readiness.** The database is reachable (`SELECT 1`, 3 s timeout) and the data is loaded. | 200 `ready`; **503** `not_ready` while starting, when PostgreSQL is down, or during shutdown |
| `GET /api/health` (also `/health`) | Detailed status: integrations, counts, monitor summary | 200 (503 while starting) |

Point external uptime monitoring at `https://ops.yourdomain.com/api/health/ready`. Neither endpoint needs a login or returns secrets.

## 11. Logs

- **Where:** `logs/ops-out.log` and `logs/ops-error.log`, created by PM2. You can also run `pm2 logs scholario-ops`.
- **Format:** one JSON object per line: `{"ts","level","service":"scholario-ops","component","msg",...}`.
- **What gets logged:**
  - startup and configuration warnings
  - database retries
  - failed or rejected API requests, slow requests, and changes (method, path, status, duration, user)
  - monitoring and worker errors
  - Cloudflare/Hostinger sync errors
  - shutdown
- **Never logged:** passwords, API tokens, JWTs, agent tokens, database passwords, query strings. Secret-looking fields are redacted.
- **Rotation:** `pm2 install pm2-logrotate` (default: rotate at 10 MB, keep 30 files).

## 12. Restart and recovery

| Situation | What happens |
|---|---|
| Node crashes | PM2 restarts it with exponential back-off (1 s doubling up to 15 s). An `uncaughtException` is logged, pending data is saved, and the process exits for a clean restart. |
| Memory above 700 MB | PM2 restarts it (`max_memory_restart`) |
| PostgreSQL down at boot | The process starts, `/ready` answers 503 and the API answers 503 "starting". It retries every 2 → 30 s and starts monitoring as soon as the database answers. No crash loop. |
| PostgreSQL down while running | Monitoring continues in memory. Writes are retried every 5 s. Admin changes are refused with 503 instead of claiming "saved". `/ready` reports 503. |
| Cloudflare / Hostinger / SMTP unavailable | Shown as `Check failed` / `Not configured` / `Permission required`. Monitoring continues. |
| A monitor check hangs | Each check has its own timeout. Concurrency is capped (`MONITOR_WORKER_CONCURRENCY`). The same monitor never runs twice at once. |
| Agent offline | The server shows STALE, then DISCONNECTED (no invented values). DR readiness shows UNKNOWN/FAIL. |
| Realtime stream drops | The browser reconnects with a fresh one-time ticket. While disconnected the dashboard refetches every 30 s. |
| Restart / deploy | `pm2 reload scholario-ops`: SIGINT → open streams closed, pending data written, PostgreSQL pool closed, exit 0 (10 s limit). |

Single instance only: the monitor scheduler and realtime state live in the process (`instances: 1` in PM2).

## 13. Backups

```bash
chmod +x deploy/backup-db.sh
./deploy/backup-db.sh             # test once → backups/ops-YYYYmmdd-HHMMSS.sql.gz (mode 600)
crontab -e
# 15 2 * * * /var/www/scholario-ops/deploy/backup-db.sh >> /var/www/scholario-ops/logs/backup.log 2>&1
```

It keeps 14 days (`KEEP_DAYS`). **Copy `backups/` off the server** because it contains your whole configuration. Also back up `.env` somewhere safe (it holds the secrets).
To restore: `gunzip -c backups/ops-XXXX.sql.gz | psql "$DATABASE_URL"` (into an empty schema, with the app stopped).

## 14. Updating and rollback

> **Production uses CI/CD.** After the one-time cutover in [docs/CI-CD.md](docs/CI-CD.md) §14, merges to `main` are deployed automatically as immutable releases with health checks and automatic rollback, and PM2 runs `/var/www/scholario-ops-releases/current`. The in-place steps below then no longer change the live app; use `sudo /usr/local/sbin/scholario-ops-release rollback` instead. They remain valid for a server without CI/CD.

**Update**

```bash
cd /var/www/scholario-ops
./deploy/backup-db.sh                 # always back up before an update
git fetch && git log --oneline HEAD..origin/main    # see what changes
git rev-parse HEAD > .last-good-commit
git pull
npm ci && npm run build
pm2 reload scholario-ops
curl -s http://127.0.0.1:4000/api/health/ready
```

**Roll back the code**

```bash
cd /var/www/scholario-ops
git checkout "$(cat .last-good-commit)"
npm ci && npm run build
pm2 reload scholario-ops
```

**Roll back the database** (only if a migration changed data in a way the old version can't read; migrations are additive so far):

```bash
pm2 stop scholario-ops
psql "$DATABASE_URL" -c 'DROP SCHEMA ops CASCADE;'
gunzip -c backups/ops-<before-update>.sql.gz | psql "$DATABASE_URL"
pm2 start scholario-ops
```

## 15. After go-live (in the dashboard)

1. Sign in and change the admin password (Users & Account). Delete `data/initial-admin-password.txt` if it exists.
2. **Setup & Connections → VPS servers → Agent.** Run the command as root on each ICT server. The agent makes outbound HTTPS only, so no ports are opened. Agent installation is a separate, approved change on the ICT servers.
3. **Database probe (optional, per server):** in `/etc/scholario-agent.conf` set `DB_ENGINE` (mysql | mariadb | postgresql), `DB_NAME` and the host/port, then restart the agent with `systemctl restart scholario-agent`. Credentials go **only** into a root-only file:
   - MySQL / MariaDB: `DB_CNF`, a `[client]` file, `chmod 600`
   - PostgreSQL: `~/.pgpass` or `DB_PGPASSFILE`

   Use a read-only monitoring DB user. In Setup → application → *Environment details*, set the same database type so Scholario Ops expects the probe.
4. **Backups:** add the `curl` call shown on the Backups page to the end of the backup job on the server, so every run reports success or failure.
5. Communications: add a notification channel and send a test.
6. Cloudflare page should show the pools as **Live**, and routing should show the pool order once the token has zone access.

## Checklist

- [ ] Ops VPS is separate from the ICT servers
- [ ] `https://ops.yourdomain.com` has a valid certificate
- [ ] `.env`: `PUBLIC_URL` is https, `JWT_SECRET` set, strong DB password, `chmod 600`
- [ ] `pm2 logs scholario-ops` shows `ready — database loaded, monitoring started` and no `"level":"error"` from `config`
- [ ] `/api/health/ready` returns 200
- [ ] `pm2 save` + `pm2 startup` done, so it survives a reboot
- [ ] Firewall: only 22/80/443 open
- [ ] Admin password changed
- [ ] Cloudflare token works, agents CONNECTED, notification channel tested, dead-man heartbeat pinging
- [ ] Nightly backup in cron, copied off the server
