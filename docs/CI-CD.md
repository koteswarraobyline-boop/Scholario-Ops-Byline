# Scholario Ops — CI/CD

How Scholario Ops itself is tested and deployed to production.
Files: [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml), [`deploy/release.sh`](../deploy/release.sh), [`deploy/ecosystem.production.cjs`](../deploy/ecosystem.production.cjs), [`deploy/backup-db.sh`](../deploy/backup-db.sh).

## 1. Architecture

```
Pull request → main            push / merge → main
      │                               │
  ┌───▼────┐                      ┌───▼────┐   tested artifact    ┌──────────────────────┐
  │  test  │  lint, build, tests  │  test  │ ───────────────────▶ │  deploy-production   │
  └────────┘  (throw-away PG)     └────────┘  release-<sha>       │  GitHub env          │
     stop                                                         │  "production"        │
                                                                  └──────────┬───────────┘
                                                     scp + ssh as scholario-deploy (key in GitHub Secrets)
                                                                             │
Production VPS ──────────────────────────────────────────────────────────────▼──────────────────────────
  sudo /usr/local/sbin/scholario-ops-release deploy <sha>   (root-owned copy of deploy/release.sh)
    /var/www/scholario-ops-releases/<id>/       ← new release prepared next to the live one
    /var/www/scholario-ops-releases/current     → symlink to the live release (atomic switch)
    /var/www/scholario-ops/                     ← unchanged: .env, data/, logs/, backups/, ecosystem.config.cjs
  PM2 "scholario-ops"  cwd=/var/www/scholario-ops  script=…/releases/current/dist-server/server.js
                       node_args=--env-file=.env   listens 127.0.0.1:4100
  nginx (unchanged)  https://scholario-ops.bylinelearning.cloud → 127.0.0.1:4100
```

- **What gets deployed** is the exact artifact the `test` job built and tested (dashboard `dist/`, server bundle `dist-server/` incl. migrations, `package-lock.json`, `deploy/`, `REVISION`). The server only installs production dependencies (`npm ci --omit=dev`) — it does not rebuild.
- **Unchanged:** application code, monitoring, health endpoints, database schema, nginx, Cloudflare, the telemetry agent, the firewall, other PM2 apps.

## 2. CI (pull requests to `main`)

Job `test` on `ubuntu-24.04`, Node.js 22, npm cache:

1. `npm ci`
2. `npm run lint`
3. `npm run build`
4. `npm test`

Any failing step fails the job. The tests need PostgreSQL. They get a **disposable `postgres:17` service container** that exists only inside the job. Its password is a fixed, non-secret value in the workflow. CI has no access to production, the production database, production `.env`, or any secret. A newer push to the same PR cancels the older run.

## 3. CD (push / merge to `main`)

1. `test` runs again on the merged commit. On `main` it also packages `scholario-ops-<sha>.tar.gz` + `.sha256` and uploads it as artifact `release-<sha>` (kept 14 days).
2. `deploy-production` runs **only if `test` succeeded**, and only when `github.ref == refs/heads/main` (event `push` or a manual `workflow_dispatch` on `main`). Pull requests never reach it.
3. It downloads the artifact, connects over SSH as the deploy user (host key pinned), uploads the artifact to `~/incoming/`, and runs `sudo -n /usr/local/sbin/scholario-ops-release deploy <sha>`.
4. The job's result is the deploy result. The job summary states one of: deployed / failed and rolled back / failed and rollback failed.

`concurrency: scholario-ops-production` (never cancelled) plus a server-side `flock` ensure that only one deployment or rollback touches production at a time. Workflow permissions are `contents: read`.

## 4. GitHub Secrets

Create a GitHub **Environment** named `production` (Settings → Environments) and add these as *environment secrets*:

| Secret | Value |
|---|---|
| `PRODUCTION_HOST` | the VPS hostname or IP |
| `PRODUCTION_USER` | `scholario-deploy` |
| `PRODUCTION_PORT` | SSH port (optional, default 22) |
| `PRODUCTION_SSH_KEY` | private key of the deploy key pair (ed25519, no passphrase) |
| `PRODUCTION_SSH_KNOWN_HOSTS` | the server's verified SSH host key line(s) — so the runner never trusts an unknown host |

Recommended environment settings:
- **Deployment branches: Selected → `main`.** Feature branches cannot deploy, even by editing the workflow.
- Optionally, **Required reviewers**: each production deploy then waits for an approval.

Application secrets (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `CLOUDFLARE_API_TOKEN`, agent tokens, SMTP, Hostinger) stay **only** in `/var/www/scholario-ops/.env` on the server. GitHub never sees them. The workflow never echoes secrets, and GitHub masks them in logs.

## 5. SSH deployment user

| | |
|---|---|
| User | `scholario-deploy` (no password, SSH key only) |
| Can write | `/home/scholario-deploy/incoming/` (uploaded artifacts) |
| Can run as root | exactly `/usr/local/sbin/scholario-ops-release deploy <sha>` and `… status` (sudoers, no password) |
| Cannot | read `.env`, run arbitrary sudo, restart other PM2 apps, change nginx/firewall, open a shell with forwarding (`restrict` key option) |

The release manager runs as root because the `scholario-ops` PM2 process belongs to root's PM2 daemon. Check this with `ps -o user= -p "$(pm2 pid scholario-ops)"`. It validates its argument (a 40-hex SHA) and only reads the artifact from the incoming directory. It copies the artifact into a root-only staging directory before it verifies the checksum, and it rejects archives that contain links, absolute paths or `..`.

**CI cannot change the release manager itself.** The installed copy is root-owned. The workflow only *warns* when `deploy/release.sh` in the repo differs from the installed copy (see §15).

## 6. Production deployment flow (`scholario-ops-release deploy <sha>`)

1. Lock, then preflight: `.env` exists (it is never read or written), `current` exists, the PM2 process exists, Node ≥ 20.
2. Copy the artifact into root-only staging. Verify the SHA-256 and the archive contents.
3. Extract into `/var/www/scholario-ops-releases/<UTC timestamp>-<sha7>/`. Verify `REVISION` equals `<sha>` and that the required files exist.
4. `npm ci --omit=dev --ignore-scripts` and `node --check dist-server/server.js`.
5. Report any **new database migrations** compared with the live release.
6. Pre-deploy database backup: `deploy/backup-db.sh` writes to `/var/www/scholario-ops/backups/`. A failed backup stops the deploy.
7. *Up to this point the live release is untouched. Any failure exits with production unchanged.*
8. Atomically switch `current` to the new release, then run `pm2 restart scholario-ops --update-env` and check that the PID changed.
9. Health checks (§7). On success: mark the release OK, run `pm2 save`, prune old releases, write the audit log.
10. On failure: print diagnostics, then roll back automatically (§8).

Every run writes a full transcript to `/var/www/scholario-ops-releases/logs/` and one line to `/var/www/scholario-ops-releases/deployments.log` (time, action, release, user, result). The run ignores SIGHUP, so a dropped SSH connection or a cancelled job does not stop it half-way.

## 7. Health checks

Each check retries every **5 s, up to 12 attempts**. All of them must pass:

| Check | Pass condition |
|---|---|
| `http://127.0.0.1:4100/api/health/live` | HTTP 200, `"status":"alive"` |
| `http://127.0.0.1:4100/api/health/ready` | HTTP 200, `"status":"ready"` — the store is loaded and PostgreSQL answers `SELECT 1` |
| listen address | port 4100 is bound to `127.0.0.1` / `[::1]` only. Anything on `0.0.0.0` / `[::]` fails the deploy. |
| `https://scholario-ops.bylinelearning.cloud/api/health/live` | HTTP 200 through nginx/Cloudflare |

On failure the script prints each attempt's status code and body, then `pm2 describe` (status/restarts/uptime/script path), `pm2 list`, and the last 60 lines of `scholario-ops` logs. These appear in the GitHub job log. The app redacts secrets from its logs, but anyone with read access to the repo's Actions logs can see these lines.

## 8. Rollback

**Automatic:** if the new release fails a health check (or PM2 doesn't restart it, or the run is interrupted after the switch):

1. The failed release is marked `.deploy-failed` and kept for diagnosis.
2. `current` is switched back to the previous known-good release, and `pm2 restart scholario-ops --update-env` runs.
3. All health checks run again.
4. Exit code `1`: deploy failed, rollback healthy. Exit code `2`: rollback also failed → page someone (§12).

The previous release is never deleted by a deploy or a rollback.

**Manual** (on the server, as an administrator):

```bash
sudo /usr/local/sbin/scholario-ops-release status             # releases, live one, recent deployments
sudo /usr/local/sbin/scholario-ops-release rollback           # newest successful release that is not live
sudo /usr/local/sbin/scholario-ops-release rollback 20261007-120000-ab12cd3   # a specific release
```

## 9. Database migrations

- Migrations are `server/migrations/NNN_*.sql`. The build copies them into `dist-server/migrations`, and the **server applies them itself at startup** (`server/db.ts`): each runs once, in a transaction, recorded in `ops.schema_migrations`. The pipeline therefore does **not** run a separate migration step and does not add any migrations.
- A pre-deploy backup is taken on every deploy.
- **Rollback never reverts the database.** The project has no down-migrations. If a release adds migrations and is then rolled back, the log says so explicitly (`DATABASE NOT ROLLED BACK: migrations … may have been applied`). The existing migrations are additive (`CREATE … IF NOT EXISTS`, new columns), so the previous release normally keeps working. If it can't, restore the pre-deploy backup (§12.3).

## 10. Release retention

- The newest **5** successful releases are kept (`KEEP_RELEASES`, never fewer than 3). The live and previous releases are always kept.
- The newest **2** failed or incomplete releases are kept (`KEEP_FAILED`).
- Pruning runs after each successful deploy. Each release is about 120 MB (mostly `node_modules`), so 5 releases need about 0.6 GB.
- Uploaded artifacts in `~scholario-deploy/incoming` are deleted after each run, and anything older than 7 days is removed.
- The GitHub artifact `release-<sha>` is kept 14 days.

## 11. Troubleshooting

| Symptom | Look at |
|---|---|
| `missing GitHub secrets` | environment `production` secrets (§4) |
| `Host key verification failed` | `PRODUCTION_SSH_KNOWN_HOSTS` doesn't match the server's host key |
| `sudo: a password is required` | `/etc/sudoers.d/scholario-ops-deploy` (§14 step 5); check with `sudo -l -U scholario-deploy` |
| `no PM2 daemon at PM2_HOME=…` / `process not found` | PM2 runs under another user. Set `PM2_HOME` in `/etc/default/scholario-ops-release` |
| `required command not found: node` | Node is not in sudo's `secure_path` (e.g. nvm). Set `EXTRA_PATH=/path/to/node/bin` in `/etc/default/scholario-ops-release` |
| `current … is not set up yet` | the one-time cutover (§14 step 6) hasn't been done |
| `another deployment/rollback is running` | wait; or check for a stuck run in `/var/www/scholario-ops-releases/logs/` |
| readiness 503 | the `checks.database` / `startupError` field in the printed body; `pm2 logs scholario-ops` |
| public check fails, local passes | nginx / Cloudflare / DNS — the release itself is fine but the deploy was rolled back by design |
| warning *release manager differs* | reinstall it (§15) |

Full transcripts: `/var/www/scholario-ops-releases/logs/`. Audit trail: `/var/www/scholario-ops-releases/deployments.log`.

## 12. Emergency manual rollback

1. **Preferred:** `sudo /usr/local/sbin/scholario-ops-release rollback` (§8).
2. **If the release manager itself is broken:**
   ```bash
   cd /var/www/scholario-ops-releases && ls -1d 20*/            # pick a release that has .deploy-ok
   sudo ln -sfn <release-id> current.tmp && sudo mv -Tf current.tmp current
   sudo pm2 restart scholario-ops --update-env
   curl -s http://127.0.0.1:4100/api/health/ready
   ```
3. **Database restore** (only if the old release can't work with the new schema). This causes downtime and loses data written since the backup:
   ```bash
   ls -lt /var/www/scholario-ops/backups/ | head                # the pre-deploy backup has the deploy's timestamp
   sudo pm2 stop scholario-ops
   # then follow DEPLOYMENT.md §14 "Roll back the database" with that file
   sudo pm2 start scholario-ops
   ```
4. **Back to the pre-CI/CD layout** (undoes the cutover): restore `ecosystem.config.cjs.pre-cicd`, then `pm2 delete scholario-ops`, start it with the same command as before, and run `pm2 save`. The old in-place build in `/var/www/scholario-ops` is left untouched by the cutover.

## 13. Security considerations

- Production secrets live only in the server's `.env` (git-ignored; CI never creates, reads, copies or deletes it). Nothing in the workflow runs `rm .env`, `git checkout`, `git clean` or similar on the server.
- GitHub gets only the SSH deploy credentials, scoped to the `production` environment, which only `main` can use.
- The SSH host key is pinned (`StrictHostKeyChecking yes`).
- The deploy key is limited by `restrict` and a single sudo rule. Its private half exists only in GitHub Secrets.
- **Residual risk:** the app runs as root under PM2, so whoever can deploy can run code as root. That is inherent to deploying code. It is controlled by branch protection, required CI, the `production` environment (optionally with required reviewers), and keeping the deploy key secret. A later hardening step is to run `scholario-ops` under its own non-root user.
- Port 4100 stays on loopback; every deploy verifies it. nginx and the firewall are not touched.
- Third-party actions: only the official `actions/*`. SSH uses the runner's OpenSSH.

## 14. One-time server setup

Run on the production VPS as an administrator. **Read-only checks first** — they change nothing:

```bash
pm2 list                                                     # note all apps; they must look the same afterwards
pm2 describe scholario-ops | grep -E 'status|script path|exec cwd|interpreter args|node.js version'
ps -o user= -p "$(pm2 pid scholario-ops)"                    # expected: root
grep -nE "script|cwd|node_args|env_production|PORT|HOST" /var/www/scholario-ops/ecosystem.config.cjs
ss -ltnp | grep ':4100'                                      # expected: 127.0.0.1:4100 only
sudo sh -c 'command -v node npm pm2 flock pg_dump curl ss tar sha256sum'   # all must resolve under sudo
node -v && pm2 -v && df -h /var/www
curl -s http://127.0.0.1:4100/api/health/ready
git -C /var/www/scholario-ops rev-parse HEAD
```

**Changes to production** — review each step, then run it:

1. **Deploy user**
   ```bash
   sudo adduser --disabled-password --gecos "Scholario Ops CI deploy" scholario-deploy
   sudo install -d -m 700 -o scholario-deploy -g scholario-deploy /home/scholario-deploy/.ssh /home/scholario-deploy/incoming
   ```
2. **Deploy key**. Generate it on your workstation, not on the server:
   ```bash
   ssh-keygen -t ed25519 -N '' -C 'github-actions scholario-ops deploy' -f scholario-deploy-key
   ```
   On the server, put the **public** key in `/home/scholario-deploy/.ssh/authorized_keys`, prefixed with `restrict `:
   ```
   restrict ssh-ed25519 AAAA… github-actions scholario-ops deploy
   ```
   Then lock down the file:
   ```bash
   sudo chown scholario-deploy:scholario-deploy /home/scholario-deploy/.ssh/authorized_keys
   sudo chmod 600 /home/scholario-deploy/.ssh/authorized_keys
   ```
   Paste the **private** key file's content into the `PRODUCTION_SSH_KEY` secret, then delete both local key files.
3. **Host key for `PRODUCTION_SSH_KNOWN_HOSTS`.** Run `ssh-keyscan -p <port> <host>` from your workstation, and compare its fingerprint (`ssh-keygen -lf -`) with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server before saving it.
4. **Release manager.** Copy `deploy/release.sh` from the reviewed commit to the server (e.g. `scp`), then:
   ```bash
   sudo install -m 0755 -o root -g root release.sh /usr/local/sbin/scholario-ops-release
   ```
   Optional overrides (only if a read-only check showed a different PM2 user or Node path) go in a root-owned `/etc/default/scholario-ops-release`, e.g. `PM2_HOME=/home/<user>/.pm2` or `EXTRA_PATH=/root/.nvm/versions/node/v22.x.y/bin`.
5. **sudo rule**
   ```bash
   echo 'scholario-deploy ALL=(root) NOPASSWD: /usr/local/sbin/scholario-ops-release deploy *, /usr/local/sbin/scholario-ops-release status' \
     | sudo tee /etc/sudoers.d/scholario-ops-deploy >/dev/null
   sudo chmod 440 /etc/sudoers.d/scholario-ops-deploy && sudo visudo -cf /etc/sudoers.d/scholario-ops-deploy
   ```
6. **Cutover to the release layout.** This adopts the build that is running now as the first release. It restarts `scholario-ops` once, for a few seconds; no other app is touched.
   ```bash
   sudo /var/www/scholario-ops/deploy/backup-db.sh
   sudo install -d -m 755 /var/www/scholario-ops-releases
   REL=/var/www/scholario-ops-releases/$(date -u +%Y%m%d-%H%M%S)-legacy
   sudo mkdir "$REL"
   sudo cp -a /var/www/scholario-ops/{dist,dist-server,node_modules,package.json,package-lock.json} "$REL"/
   git -C /var/www/scholario-ops rev-parse HEAD | sudo tee "$REL/REVISION" >/dev/null
   sudo touch "$REL/.deploy-ok"
   sudo ln -sfn "$(basename "$REL")" /var/www/scholario-ops-releases/current
   sudo cp -a /var/www/scholario-ops/ecosystem.config.cjs /var/www/scholario-ops/ecosystem.config.cjs.pre-cicd
   ```
   Edit `/var/www/scholario-ops/ecosystem.config.cjs`. Change **only** `script` to `'/var/www/scholario-ops-releases/current/dist-server/server.js'`. Make sure `cwd` resolves to `/var/www/scholario-ops`, and keep `node_args: '--env-file=.env'`, name, env and logs as they are. Compare with `deploy/ecosystem.production.cjs`. PM2 only picks up a new script path on a fresh start:
   ```bash
   sudo pm2 delete scholario-ops
   sudo pm2 start /var/www/scholario-ops/ecosystem.config.cjs   # add --env production if it was started that way (env_production)
   sudo pm2 save
   curl -s http://127.0.0.1:4100/api/health/ready && ss -ltn | grep ':4100'
   sudo /usr/local/sbin/scholario-ops-release status
   pm2 list                                                     # other apps unchanged
   ```
7. **Verify the deploy user** (read-only):
   ```bash
   sudo -u scholario-deploy sudo -n /usr/local/sbin/scholario-ops-release status
   ```

### First deployment

1. Finish §14 and the GitHub environment and secrets (§4).
2. Open a PR with these changes into `main`. Only `test` runs; it must be green.
3. Merge. `test` runs again, then `deploy-production`. Watch the job log; the summary states the result.
4. On the server, run `sudo /usr/local/sbin/scholario-ops-release status`. Then open https://scholario-ops.bylinelearning.cloud and sign in.

If a merge to `main` happens before the server is ready, `deploy-production` fails at *Configure SSH* or *preflight* with production unchanged.

## 15. Updating the release manager

When a commit changes `deploy/release.sh`, the deploy log shows a warning. After reviewing the change, an administrator reinstalls it from that commit:

```bash
sudo install -m 0755 -o root -g root release.sh /usr/local/sbin/scholario-ops-release
```
