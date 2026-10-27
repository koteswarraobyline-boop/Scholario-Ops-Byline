# Production live checklist (operator actions)

In-repo work for multi-app Ops readiness is complete. These steps run on the **live host** and cannot be finished from git alone. Do them after `26/10` (or later) is merged to `main` and CI has deployed.

## 1. Confirm the release is live

- [ ] GitHub Actions on `main`: `test` green, then `deploy-production` ran (or was intentionally skipped).
- [ ] `GET https://<ops-host>/api/health/live` returns ok.
- [ ] `GET https://<ops-host>/api/health` shows a recent `schedulerAgeMs` (scheduler is running).
- [ ] `GET https://<ops-host>/api/health/ready` returns ready (database reachable).

## 2. Agents on each VPS

- [ ] In **Setup**, open each PRD (and DR, if used) server → install or update agent from the dashboard (do not copy a loose `.py` by hand).
- [ ] Agent status shows **CONNECTED** with the expected version.
- [ ] CPU / RAM / disk and (if configured) database probes update.

## 3. Cloudflare (read-only token)

- [ ] `CLOUDFLARE_API_TOKEN` has Zone Read + Load Balancing Read for the application zone(s).
- [ ] Cloudflare page lists pools as Live; routing shows pool order **or** a clear “token cannot list zones” error (not a silent miss).
- [ ] SSL mode on the zone in front of Ops is **Full (strict)** if proxied.

## 4. Notifications

- [ ] At least one channel (Email / Teams / webhook / PagerDuty) enabled in Communications.
- [ ] Escalation policies saved for the severities you page on.
- [ ] Send a channel test; confirm delivery in the real inbox / Teams / webhook receiver (API “accepted” is not enough).

## 5. Backups

- [ ] Application backup jobs POST to `/api/v1/backups/report` (or agent reports).
- [ ] Ops DB: `deploy/backup-db.sh` runs on schedule; `deploy/verify-backup.sh` has written a successful restore-test status at least once.
- [ ] Auto-failover remains **off** until a restore drill and failover rehearsal are approved.

## 6. Applications inventory

- [ ] Every real product has an application row (PRD-only is valid; DR is optional).
- [ ] Shared servers list correctly under Setup → Used by.
- [ ] Overview shows **all** applications, not a single ICT pair.

## Done when

All boxes above are checked on the live host, and the overview reflects live data rather than UNKNOWN / NOT CONFIGURED for configured systems.
