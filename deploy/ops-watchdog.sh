#!/usr/bin/env bash
# Scholario Ops — watchdog for the Ops server itself, run from cron on ANOTHER server you own
# (the DR node is the natural choice: Scholario Ops already alerts when the DR node's agent stops
# reporting, so the two servers watch each other). No third-party monitoring service is involved.
#
#   sudo install -m 0755 -o root -g root deploy/ops-watchdog.sh /usr/local/sbin/scholario-ops-watchdog
#   sudo install -m 0600 -o root -g root /dev/null /etc/scholario-ops-watchdog.conf   # then edit it
#   crontab -e  →  * * * * * /usr/local/sbin/scholario-ops-watchdog >> /var/log/scholario-ops-watchdog.log 2>&1
#
# Every run checks GET $OPS_URL/api/health/ready (process + database + monitor scheduler).
# After FAILURES_BEFORE_ALERT consecutive failures it alerts once, reminds every REMIND_EVERY_MIN
# while the outage lasts, and sends a recovery message with the downtime when Ops answers again.
# An alert that could not be delivered is retried on the next run (never silently lost).
#
# /etc/scholario-ops-watchdog.conf (KEY=value, mode 0600 — it holds credentials):
#   OPS_URL=https://ops.your-domain             # required
#   FAILURES_BEFORE_ALERT=3                     # 3 runs ≈ 3 minutes
#   REMIND_EVERY_MIN=60
#   # Email through your own SMTP relay (curl's SMTP client; no local MTA needed)
#   SMTP_URL=smtps://smtp.your-domain:465       # or smtp://host:587 (STARTTLS is required)
#   SMTP_USER=alerts@your-domain
#   SMTP_PASS=...
#   MAIL_FROM=alerts@your-domain
#   MAIL_TO=oncall@your-domain,it-team@your-domain
#   # And/or your own Teams / Slack incoming webhook ({"text": "..."})
#   WEBHOOK_URL=https://...
#   # Optional: after every successful check, ping a CRON_HEARTBEAT monitor in Scholario Ops so Ops
#   # opens an incident if this watchdog itself stops running (cron removed, DR node down).
#   PING_URL=https://ops.your-domain/api/v1/heartbeat/<monitor token>
#
# Exit code: 0 = Ops healthy, 1 = Ops failing (alerted or below the threshold), 2 = configuration error.
set -uo pipefail
umask 077

CONF="${WATCHDOG_CONF:-/etc/scholario-ops-watchdog.conf}"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/scholario-ops-watchdog}"
log() { echo "$(date '+%F %T') $*"; }

[ -f "$CONF" ] || { log "config $CONF not found" >&2; exit 2; }
# Read KEY=value lines without executing the file
conf() {
  grep -E "^[[:space:]]*$1=" "$CONF" | tail -1 \
    | sed -E "s/^[[:space:]]*$1=//; s/^[\"']//; s/[\"'][[:space:]]*\$//" || true
}
OPS_URL="$(conf OPS_URL)"; OPS_URL="${OPS_URL%/}"
THRESHOLD="$(conf FAILURES_BEFORE_ALERT)"; THRESHOLD="${THRESHOLD:-3}"
REMIND_MIN="$(conf REMIND_EVERY_MIN)"; REMIND_MIN="${REMIND_MIN:-60}"
SMTP_URL="$(conf SMTP_URL)"; SMTP_USER="$(conf SMTP_USER)"; SMTP_PASS="$(conf SMTP_PASS)"
MAIL_FROM="$(conf MAIL_FROM)"; MAIL_TO="$(conf MAIL_TO)"
WEBHOOK_URL="$(conf WEBHOOK_URL)"
PING_URL="$(conf PING_URL)"
[[ "$OPS_URL" =~ ^https?:// ]] || { log "OPS_URL must start with http:// or https://" >&2; exit 2; }
[[ "$THRESHOLD" =~ ^[1-9][0-9]*$ && "$REMIND_MIN" =~ ^[0-9]+$ ]] || { log "FAILURES_BEFORE_ALERT / REMIND_EVERY_MIN must be numbers" >&2; exit 2; }
if [ -z "$WEBHOOK_URL" ] && { [ -z "$SMTP_URL" ] || [ -z "$MAIL_TO" ] || [ -z "$MAIL_FROM" ]; }; then
  log "no alert channel: set WEBHOOK_URL and/or SMTP_URL + MAIL_FROM + MAIL_TO" >&2; exit 2
fi

mkdir -p "$STATE_DIR"
# One run at a time (portable lock: mkdir is atomic). A lock older than 10 min is from a killed run.
LOCK="$STATE_DIR/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT

STATE="$STATE_DIR/state"
FAILURES=0; FIRST_FAIL=0; ALERTED=0; LAST_ALERT=0
# KEY=integer lines written by this script; parsed, never executed
if [ -f "$STATE" ]; then
  while IFS="=" read -r k v; do
    case "$k" in FAILURES|FIRST_FAIL|ALERTED|LAST_ALERT) [[ "$v" =~ ^[0-9]+$ ]] && printf -v "$k" %s "$v" ;; esac
  done < "$STATE"
fi
save_state() { printf 'FAILURES=%d\nFIRST_FAIL=%d\nALERTED=%d\nLAST_ALERT=%d\n' "$FAILURES" "$FIRST_FAIL" "$ALERTED" "$LAST_ALERT" > "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"; }

NOW="$(date +%s)"
HOST="$(hostname 2>/dev/null || echo unknown)"
json_str() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\r'/}"; s="${s//$'\t'/ }"; printf '"%s"' "$s"; }

# Credentials go to curl through a config on stdin, never on the command line (ps would show them).
# Values are quoted for curl config syntax (backslash and double quote escaped).
cq() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '"%s"' "$s"; }
send_webhook() {
  [ -n "$WEBHOOK_URL" ] || return 1
  printf 'url = %s\n' "$(cq "$WEBHOOK_URL")" | curl -fsS --max-time 15 -K - -H 'Content-Type: application/json' \
    --data-binary "{\"text\": $(json_str "$1"$'\n\n'"$2")}" -o /dev/null
}
send_mail() {
  [ -n "$SMTP_URL" ] && [ -n "$MAIL_TO" ] && [ -n "$MAIL_FROM" ] || return 1
  local rcpts=() r msg list nl=$'\n' crlf=$'\r\n'
  IFS=',' read -ra list <<< "$MAIL_TO"
  for r in "${list[@]}"; do r="${r// /}"; [ -n "$r" ] && rcpts+=(--mail-rcpt "$r"); done
  msg="From: Scholario Ops watchdog <$MAIL_FROM>${crlf}To: $MAIL_TO${crlf}Subject: $1${crlf}Date: $(date -R)${crlf}"
  msg+="Content-Type: text/plain; charset=utf-8${crlf}${crlf}${2//$nl/$crlf}${crlf}"
  {
    printf 'url = %s\n' "$(cq "$SMTP_URL")"
    if [ -n "$SMTP_USER" ]; then printf 'user = %s\n' "$(cq "$SMTP_USER:$SMTP_PASS")"; fi
  } | curl -fsS --max-time 30 -K - --ssl-reqd --mail-from "$MAIL_FROM" "${rcpts[@]}" -T <(printf '%s' "$msg")
}
notify() {
  local delivered=1
  send_webhook "$1" "$2" && delivered=0 || { [ -n "$WEBHOOK_URL" ] && log "webhook delivery failed" >&2; }
  send_mail "$1" "$2" && delivered=0 || { [ -n "$SMTP_URL" ] && log "email delivery failed" >&2; }
  return $delivered
}
fmt_dur() { local s=$1; [ "$s" -lt 120 ] && echo "${s}s" || { [ "$s" -lt 7200 ] && echo "$((s / 60)) min" || echo "$((s / 3600)) h $(((s % 3600) / 60)) min"; }; }

# ── The check ────────────────────────────────────────────────────────────────
BODY="$(curl -sS --max-time 15 -w '\n%{http_code}' "$OPS_URL/api/health/ready" 2>&1)"
CODE="${BODY##*$'\n'}"; BODY="${BODY%$'\n'*}"
if [ "$CODE" = 200 ] && [[ "$BODY" == *'"ready"'* ]]; then
  if [ "$ALERTED" = 1 ]; then
    DOWN=$((NOW - FIRST_FAIL))
    if notify "[RECOVERED] Scholario Ops is back" "Scholario Ops ($OPS_URL) answers again after $(fmt_dur "$DOWN") of failures.
Checked from $HOST at $(date -u '+%F %T') UTC."; then
      log "RECOVERED after $(fmt_dur "$DOWN") — recovery message sent"
    else
      log "RECOVERED after $(fmt_dur "$DOWN") — recovery message could NOT be delivered" >&2
    fi
  fi
  FAILURES=0; FIRST_FAIL=0; ALERTED=0; LAST_ALERT=0
  save_state
  [ -n "$PING_URL" ] && { curl -fsS --max-time 10 -o /dev/null -K - <<< "url = $(cq "$PING_URL")" || log "heartbeat ping to Scholario Ops failed" >&2; }
  exit 0
fi

# Failing: say why (status code + the checks that failed, or curl's error)
if [ "$CODE" = 000 ] || ! [[ "$CODE" =~ ^[0-9]{3}$ ]]; then REASON="no answer: ${BODY:0:200}"
else REASON="HTTP $CODE: $(printf '%s' "$BODY" | tr -d '\n' | cut -c1-300)"; fi
FAILURES=$((FAILURES + 1))
[ "$FIRST_FAIL" = 0 ] && FIRST_FAIL=$NOW
log "check failed ($FAILURES/$THRESHOLD): $REASON"

if [ "$FAILURES" -ge "$THRESHOLD" ] && { [ "$ALERTED" = 0 ] || { [ "$REMIND_MIN" -gt 0 ] && [ $((NOW - LAST_ALERT)) -ge $((REMIND_MIN * 60)) ]; }; }; then
  KIND="DOWN"; [ "$ALERTED" = 1 ] && KIND="STILL DOWN"
  if notify "[$KIND] Scholario Ops is not healthy" "Scholario Ops ($OPS_URL) has failed its health check $FAILURES times in a row (since $(date -u -d "@$FIRST_FAIL" '+%F %T' 2>/dev/null || echo "$FIRST_FAIL") UTC, $(fmt_dur $((NOW - FIRST_FAIL))) ago).

Last result: $REASON

While Ops is down, nothing else alerts you about your applications. Check the Ops server: pm2 status, pm2 logs scholario-ops, systemctl status postgresql nginx.
Checked from $HOST."; then
    ALERTED=1; LAST_ALERT=$NOW
    log "$KIND alert sent"
  else
    log "$KIND alert could NOT be delivered — will retry next run" >&2
  fi
fi
save_state
exit 1
