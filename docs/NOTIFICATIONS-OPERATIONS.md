# Notifications — operations guide

How the notification secrets key works and how to recover it, the known reliability limits, and a
controlled plan for testing real deliveries. Covers `server/secrets.ts`, `server/notify.ts`,
`server/netguard.ts`, `server/leader.ts` and the Communications page.

---

## 1. Secrets key (encryption of channel targets)

### What is encrypted
Channel targets are encrypted with AES-256-GCM before they are written to PostgreSQL (`channels` table).
That covers Teams/webhook URLs, PagerDuty routing keys and email recipients.
- **Stored format:** `enc:v1:<base64(iv | tag | ciphertext)>`.
- **In memory:** values stay in plaintext so they can be sent.
- **Protects against:** leaked database dumps, backups and replicas.
- **Does not protect against:** someone who controls the application server, because the key lives there too.

### Where the key comes from
1. `NOTIFY_SECRETS_KEY`, if it is set: 32 bytes, as 64 hex characters or as base64.
2. Otherwise the file `DATA_DIR/notify-secrets.key`.
   - It is created on the **first** start, but only while no encrypted target exists yet: 32 random bytes, base64.
   - It is created with mode `0600` and exclusive create (`wx`), so an existing file is never overwritten.

The key is never logged, returned by the API or shown in the UI.

### Protecting the key file
- **Linux:** `chmod 600 data/notify-secrets.key`, owned by the service user.
- **Windows:** `0600` has no effect. Restrict the file with ACLs:
  ```powershell
  icacls data\notify-secrets.key /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
  ```
- Keep it out of git. `data/` is ignored; check with `git check-ignore data/notify-secrets.key`.

### Backup
- Back up the key file, or the `NOTIFY_SECRETS_KEY` value, **together with `.env`** and keep it separate from the database backups. A database backup without its key cannot be decrypted.
- To confirm a backup copy matches the live key without displaying either, compare hashes:
  ```powershell
  (Get-FileHash data\notify-secrets.key).Hash -eq (Get-FileHash X:\backup\notify-secrets.key).Hash
  ```

### Restore
1. Stop the app.
2. Copy the backed-up file to `DATA_DIR/notify-secrets.key`, or set `NOTIFY_SECRETS_KEY` to the backed-up value. Re-apply the permissions above.
3. Start the app.

### Verifying that secrets are readable after a restore
Use any of these. None of them sends a message.
- **Communications → Notification health:** no "Secrets key problem" line, and the status is not DEGRADED because of the key.
- **API:** `GET /api/v1/notifications/health` (administrator/operator) returns `"secretsKey": "OK"`.
  - Anything else means either the key cannot be loaded, or N channel targets do not decrypt with the current key.
- **Server log:** no `secrets` error saying "a stored channel secret cannot be decrypted".

### Behaviour by situation
| Situation | What happens |
|---|---|
| First start, no encrypted data | A key file is created. Info log: "created the notification secrets key … back it up". |
| Key file **missing** while encrypted targets exist (lost key) | **No new key is created.** This changed in this release; previously a new key was silently generated, leaving a mix of two keys once the old one was restored. Details below. |
| `NOTIFY_SECRETS_KEY`, or the key file, is not 32 bytes | Treated like a missing key: health reports the error, saves are refused, stored values are kept. |
| A **different** valid key, e.g. the env key changed | Old targets cannot be decrypted. They are kept verbatim, health shows "N channel target(s) cannot be decrypted", and sends to them fail with "cannot be decrypted". New saves use the new key. A key fingerprint (HMAC of a fixed label, 16 hex characters; the key cannot be derived from it) is stored in the `meta` table as `notify_secrets_key_fp`. At startup a different key is logged as an error and health is DEGRADED with "The secrets key changed (fingerprint OLD → NEW)", or, while targets are unreadable, the unreadable count plus both fingerprints. The stored fingerprint is only replaced once every target is readable with the current key. |
| Key permanently lost | The stored targets are unrecoverable by design. Edit each affected channel and enter its target again. |

When the key file is missing while encrypted targets exist:
- Health shows the problem and its status is DEGRADED.
- Creating or editing a channel is refused with **HTTP 503**: "Channel secrets cannot be stored safely …".
- Stored ciphertext is written back unchanged.
- Sends to those channels fail with "cannot be decrypted".
- Restoring the backed-up key fixes everything.

### Rotation
**Not supported.** There is no re-encryption command. A manual rotation means:
1. Set the new key.
2. Restart.
3. Re-enter every channel target.

Until all targets are re-entered, the health view lists the unreadable ones and reports the fingerprint change. Plan rotation as a maintenance task, and keep the old key until every channel shows `OK`. The warning clears, and the new fingerprint is recorded, on the first save after the last old target has been re-entered.

---

## 2. Reliability review (notification pipeline)

Each area is listed with its current behaviour, the evidence (tests) and any limitation.

**Retries:**
- Behaviour: 3 attempts (after 2 s, then 8 s, each with up to 30 % jitter); `Retry-After` is honoured (capped). 4xx responses other than 408 and 429, SSRF refusals and invalid configuration are not retried.
- Evidence: `escalation.test.ts` covers "temporary failure (503) is retried…" and "retries honour Retry-After (429)…".
- Limits: the per-attempt timeout is fixed at 10 s.

**Duplicate protection after a restart:**
- Behaviour: the cooldown and "FIRING was sent" are rebuilt from the delivery log.
- Evidence: "duplicate protection survives a restart".

**Escalation:**
- Behaviour: steps are stored on the incident and survive a restart. Acknowledging or resolving an incident cancels its pending steps. Only one process sends, enforced by a PostgreSQL advisory lock.
- Evidence: "multi-step escalation …", "one worker …".
- Limits: if the severity changes in the middle of an escalation, steps already sent are not repeated (the step index carries over).

**Quiet hours:**
- Behaviour: IANA timezones; the weekday and the window are evaluated in that zone, so DST is handled by `Intl`. CRITICAL and EMERGENCY are never held. Held pages are sent when quiet hours end.
- Evidence: `quiet-hours.test.ts`; "quiet hours: …" in `escalation.test.ts`.

**Grouping:**
- Behaviour: non-critical alerts for one application are summarised within `NOTIFY_GROUP_WINDOW_SEC` (default 60 s). Each follow-up alert stores `notifyGroupPending` on the incident, so a restart still sends the summary (leader only). A summary already recorded in the delivery log is not sent again.
- Evidence: "grouping: …" and "grouping survives a restart: …".
- Limits: the first alert is always sent immediately. CRITICAL and EMERGENCY are never grouped. An alert that recovered before the summary is dropped.

**SSRF:**
- Behaviour:
  - IPv4 and IPv6, including mapped and embedded IPv4 forms;
  - DNS checked at connect time, so rebinding doesn't get through;
  - redirects are not followed;
  - IP-literal hosts are checked before connecting;
  - metadata addresses can never be allowlisted.
  - the mail server is guarded too: its host name is resolved once per send/verify, each address is checked, and the connection is pinned to the checked address (TLS still verifies the certificate against the host name).
- Evidence: `netguard.test.ts`; "SSRF guard at delivery"; save-time 400s in `production.test.ts`; "SSRF guard for the mail server" and "the connection goes to the checked address" in `email.test.ts`.
- **Behaviour change:** a mail relay on loopback or a private address (e.g. `SMTP_HOST=127.0.0.1` or `10.x`) now needs that address in `NOTIFY_ALLOWED_PRIVATE_TARGETS`. Public providers (Gmail, Microsoft 365, SendGrid, SES, …) are unaffected. Metadata addresses (169.254.x) are always refused.

**Secrets:**
- Behaviour: see section 1.
- Evidence: `secrets.test.ts`, including the lost-key and key-fingerprint tests.
- Limits: rotation is manual (see section 1).

**Email:**
- Behaviour: `SMTP_SERVICE` presets, `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT`. Missing or inconsistent settings are named precisely and no connection is attempted. Login, TLS, certificate and rejected-recipient errors are permanent with a plain reason. Network errors and timeouts (10 s connect, 20 s socket) are retried. The password is never logged or shown; it is masked even if the server echoes it. Admins can run **Check SMTP** (`POST /api/v1/integrations/smtp/verify`), which logs in without sending mail.
- Evidence: `email.test.ts` (fake SMTP server on `127.0.0.1`; no real mail).

**Teams destination:**
- Behaviour: chat and channel links (`teams.microsoft.com`, `teams.cloud.microsoft`, `teams.live.com`), Power Automate / Power Apps editor pages, SharePoint and sign-in pages, and Workflows URLs without `sig=` are refused at save time (HTTP 400 with the fix) and again before sending, so a channel saved by an older version is never POSTed.
- Evidence: "Teams: …" in `escalation.test.ts`; save-time cases in `production.test.ts`.

**Migration compatibility and rollback:**
- No schema migration in this release. The new data (`notifyGroupPending` on incidents, `notify_secrets_key_fp` in `meta`) are optional JSON fields or meta keys; the previous version ignores them.
- Rollback = deploy the previous build. Pending grouped summaries are then not replayed after a restart (previous behaviour). Delete the meta key `notify_secrets_key_fp` only if you roll forward again with a different key on purpose.

**Metrics and alerting:**
- Behaviour: the health endpoint and card show success rate, p50/p95, pending, in-flight and retries, the per-channel breakdown and the key status. A channel that fails 3 times in a row raises an alert, which resolves on the next success.
- Evidence: "retries honour Retry-After … raises an alert".
- Limits: there is no external watchdog, deliberately; a dead process cannot alert about itself.

**Browser live connection:**
- Behaviour: one SSE stream per tab, closed on `pagehide` and reopened on `pageshow`.
- Evidence: `responsive.test.ts` "live stream: … no leaked streams".

### 2.1 Durable grouped summaries (implemented)
1. When an alert is put into a group buffer, `notifyGroupPending` is set to the current time on the incident. Incidents are stored as JSON, so no migration was added.
2. When the summary is sent (or the alert recovers first), the flag is cleared.
3. When this process becomes the notification leader, open incidents whose flag is still set are grouped per application and one summary is sent immediately. Recovered incidents are dropped. CRITICAL and EMERGENCY are never grouped. Alerts still sitting in a live window are left for that window.
4. If the delivery log already has a delivered FIRING for that incident (or a summary whose text names it), the flag is cleared and nothing is sent again.

---

## 3. Controlled delivery test plan

**Rule:** automated and local tiers use only mocks and `127.0.0.1` receivers. They need no credentials and send no real messages. Tier 3 sends real messages and runs only after explicit approval, to sandbox destinations.

### Tier 1 — automated (runs in `npm run test:local`, disposable DB `scholario_ops_ui_test`)
Already covered:
- delivered; rejected (400, not retried); temporary 503 (retried); 429 with `Retry-After`;
- redirect refused; private/metadata target refused before connecting;
- invalid URL rejected at save time;
- Teams Adaptive Card vs MessageCard, and the Teams 405 hint;
- webhook HMAC signature;
- the delivery log records result, attempts and error;
- channel-failing alert and its recovery;
- the key-loss behaviour.

### Tier 2 — local receivers, manual (no credentials)
Start the app with test-only environment variables in the shell. **Not** in `.env`.
```powershell
$env:NOTIFY_ALLOWED_PRIVATE_TARGETS = '127.0.0.1'   # allows plain http to the local receiver
```
Then run a small Node receiver on `127.0.0.1:<port>` that answers per path. Create one WEBHOOK channel per path and use **Send test**:

| Path | Receiver answers | Expected in the delivery log |
|---|---|---|
| `/ok` | 200 | Delivered, 1 attempt |
| `/reject` | 400 with body `bad payload` | Failed, 1 attempt, error `HTTP 400 …: bad payload` |
| `/flaky` | 503, 503, then 200 | Delivered, 3 attempts |
| `/slow` | 429 with `Retry-After: 5` | Retried after about 5 s |
| `/hang` | Never answers | 3 attempts × "timed out after 10 s", then Failed |
| `/redirect` | 302 | Failed, "redirects are not followed", not retried |
| (closed port) | — | Retried (ECONNREFUSED), then Failed |

Per destination:
- **Slack:** uses the WEBHOOK type. The payload's `text` field is what Slack displays; check it at `/ok`.
- **Teams:** point a TEAMS channel at the receiver.
  - A Workflows-style URL can't be mocked by hostname, so check the payload shape in Tier 1 (it already is).
  - Confirm the 405 hint by answering 405.
- **Email:**
  - With SMTP unset: expect "SMTP is not configured" (permanent).
  - Then start a local fake SMTP server and set `SMTP_HOST=127.0.0.1`, `SMTP_PORT=<port>`, `SMTP_SECURE=false`, `SMTP_FROM=ops@example.test` and `NOTIFY_ALLOWED_PRIVATE_TARGETS=127.0.0.1` in the shell. Mailpit, or a minimal Node `net` server that can answer `250` or `550`, both work. Use **Check SMTP** first.
  - Check delivered for `250`, and failed with the SMTP error for `550`.
- **PagerDuty:** the Events API URL is fixed (`events.pagerduty.com`), so it can't be pointed at a local receiver.
  - Locally, verify the save-time validation and the "cannot be decrypted" / invalid-configuration paths.
  - The payload mapping (trigger/resolve, `dedup_key` = incident, severity mapping) is covered by "PagerDuty: FIRING triggers and RESOLVED resolves…" in `escalation.test.ts`.
- **Invalid configuration**, for every type:
  - an empty target, which is refused at save time;
  - a private target without an allowlist, which gets a 400 at save time;
  - an undecryptable target (section 1), which fails with a clear message and is not retried.

### Tier 3 — controlled real delivery (needs explicit approval for each run)
- Use dedicated **sandbox** destinations only:
  - a test Teams channel with a Workflows webhook;
  - a Slack test workspace with an incoming webhook;
  - a PagerDuty trial/dev service with an Events v2 key;
  - a test mailbox.
- Send one **TEST** message per channel with **Send test**. It goes to that channel only and starts no escalation.
- Record the delivery log IDs and confirm receipt at the destination.
- For PagerDuty, resolve the test incident afterwards.
- Rollback: disable or delete the sandbox channels. Nothing else changes.
- Never run Tier 3 from the test suite or against production channels.

---

## 4. Setup

### Email
The server reads SMTP settings once, at startup, from `.env`:
- `npm run dev` / `npm start` load `.env` from the project root.
- PM2 in production loads `/var/www/scholario-ops/.env` (`cwd` + `--env-file=.env`).

Variables already set in the shell win over `.env`. After changing them, restart the process. The Notifications page shows the exact missing setting, and **Check SMTP** (admin) tests the login without sending a mail. Local development does not disable email: with SMTP configured, local test sends are real mail.

**Gmail / Google Workspace** (port 587, STARTTLS):
```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=alerts@yourdomain.com
SMTP_PASS=<16-character app password>
SMTP_FROM=Scholario Ops <alerts@yourdomain.com>
```
- Use an **app password** (Google Account → Security → 2-Step Verification → App passwords). Never use the normal account password; Google rejects it with `535`, which shows as "login failed".
- Workspace admins may have to allow app passwords. `SMTP_FROM` must be that account or an alias configured in Gmail.
- `SMTP_SERVICE=Gmail` is equivalent: it uses `SMTP_PORT` when that is set, else 465 with TLS.
- Port 465 with `SMTP_SECURE=false`, or 587 with `SMTP_SECURE=true`, is reported as a configuration error instead of a TLS timeout.

**Local (this Windows machine):** edit the root `.env` yourself, then stop `npm run dev` (Ctrl+C) and start it again from the project root. Prefer a dedicated test mailbox, and send tests only to addresses you own.

**Hosted:** set the same keys in the server's `/var/www/scholario-ops/.env`, using that environment's own mailbox and app password (not the local one), then `pm2 restart scholario-ops --update-env`. Do not copy the local `.env` to the server.

### Teams
- A link from **Get link to channel** or a chat (`teams.microsoft.com/l/...`, `teams.cloud.microsoft/l/...`) opens Teams in a browser. It is not a webhook, and a POST to it returns **405**.
- Create the webhook in Teams: channel → **⋯** → **Workflows** → "Post to a channel when a webhook request is received". Copy the URL it gives you. It looks like one of these:
  - `https://<region>.logic.azure.com/workflows/<id>/triggers/manual/paths/invoke?api-version=…&sp=…&sv=…&sig=…`
  - `https://<env>.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/<id>/triggers/manual/paths/invoke?api-version=…&sig=…`
- The `sig=` part is the secret. The URL is stored encrypted and masked in the UI.
- Payload: Workflows URLs get `{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":<Adaptive Card 1.4>}]}`. Legacy `*.webhook.office.com` connector URLs get a MessageCard.
- Channel links, Power Automate editor pages, SharePoint and sign-in pages, and Workflows URLs without `sig=` are refused at save time with these instructions.
