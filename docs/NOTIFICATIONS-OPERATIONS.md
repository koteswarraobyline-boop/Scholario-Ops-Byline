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
| A **different** valid key, e.g. the env key changed | Old targets cannot be decrypted. They are kept verbatim, health shows "N channel target(s) cannot be decrypted", and sends to them fail with "cannot be decrypted". New saves use the new key. This cannot be detected beyond that warning, because no key fingerprint is stored. |
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

Until all targets are re-entered, the health view lists the unreadable ones. Plan rotation as a maintenance task, and keep the old key until every channel shows `OK`.

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
- Behaviour: non-critical alerts for one application are summarised within `NOTIFY_GROUP_WINDOW_SEC` (default 60 s).
- Evidence: "grouping: …".
- Limits: **the summary is held in memory**. If the process crashes inside the window, the follow-up alerts are not sent (see 2.1). The first alert is always sent immediately.

**SSRF:**
- Behaviour:
  - IPv4 and IPv6, including mapped and embedded IPv4 forms;
  - DNS checked at connect time, so rebinding doesn't get through;
  - redirects are not followed;
  - IP-literal hosts are checked before connecting;
  - metadata addresses can never be allowlisted.
- Evidence: `netguard.test.ts`; "SSRF guard at delivery"; save-time 400s in `production.test.ts`.
- Limits: the SMTP host is operator configuration (`.env`) and is not passed through the guard.

**Secrets:**
- Behaviour: see section 1.
- Evidence: `secrets.test.ts`, including the new lost-key test.
- Limits: no rotation, and no key fingerprint.

**Metrics and alerting:**
- Behaviour: the health endpoint and card show success rate, p50/p95, pending, in-flight and retries, the per-channel breakdown and the key status. A channel that fails 3 times in a row raises an alert, which resolves on the next success.
- Evidence: "retries honour Retry-After … raises an alert".
- Limits: there is no external watchdog, deliberately; a dead process cannot alert about itself.

**Browser live connection:**
- Behaviour: one SSE stream per tab, closed on `pagehide` and reopened on `pageshow`.
- Evidence: `responsive.test.ts` "live stream: … no leaked streams".

### 2.1 Proposal: durable grouped summaries (not implemented)
The smallest safe change:
1. When an alert is put into a group buffer, set `notifyGroupPending: <ISO time>` on the incident. It is persisted like every other incident field, so no migration is needed because incidents are stored as JSON.
2. When the summary is sent, clear the flag on every incident it covers.
3. At startup (leader only), collect open incidents whose flag is still set, group them per application, and send one summary immediately.
   - Use the same rules as today: recovered incidents are dropped, and CRITICAL alerts are never grouped.
   - Clear the flags afterwards.
4. Deduplicate against the delivery log, as FIRING already does, so a crash after sending but before clearing doesn't send twice.

Existing behaviour stays unchanged when nothing crashes. Implementing this needs approval.

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
  - Then start a local fake SMTP server and set `SMTP_HOST=127.0.0.1`, `SMTP_PORT=<port>`, `SMTP_SECURE=false` and `SMTP_FROM=ops@example.test` in the shell. Mailpit, or a minimal Node `net` server that can answer `250` or `550`, both work.
  - Check delivered for `250`, and failed with the SMTP error for `550`.
- **PagerDuty:** the Events API URL is fixed (`events.pagerduty.com`), so it can't be pointed at a local receiver.
  - Locally, verify the save-time validation and the "cannot be decrypted" / invalid-configuration paths.
  - The payload mapping (trigger/resolve, `dedup_key` = incident, severity mapping) is checked by code review. An automated payload test is a follow-up.
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
