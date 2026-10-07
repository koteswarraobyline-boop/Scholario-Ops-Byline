#!/usr/bin/env bash
# Scholario Ops — release manager (runs ON the production server).
#
# Installed once by an administrator as a root-owned copy:
#   sudo install -m 0755 -o root -g root deploy/release.sh /usr/local/sbin/scholario-ops-release
# CI never overwrites the installed copy (it runs as root; see docs/CI-CD.md).
#
#   scholario-ops-release deploy <git-sha>    install the CI artifact for <git-sha>, switch, health-check, auto-rollback
#   scholario-ops-release rollback [release]  switch back to the previous (or the named) successful release
#   scholario-ops-release status              current release, retained releases, PM2 state
#
# Layout (nginx is untouched; Node keeps listening on 127.0.0.1:4100):
#   /var/www/scholario-ops/                   APP_HOME: .env, data/, logs/, backups/, ecosystem.config.cjs (PM2 cwd)
#   /var/www/scholario-ops-releases/<id>/     immutable releases (dist/, dist-server/, node_modules/, package*.json)
#   /var/www/scholario-ops-releases/current   symlink -> the live release; PM2 script = current/dist-server/server.js
#
# Never touches .env, data/, logs/, backups/, nginx, the firewall, or other PM2 apps.
# Database migrations are NOT run here: the server applies them itself at startup (server/db.ts).
set -Eeuo pipefail
umask 022

# ── Configuration (defaults; an administrator may override them in /etc/default/scholario-ops-release) ──
CONF_FILE=/etc/default/scholario-ops-release
# Test/manual override of the config file — honoured only when not invoked through sudo
if [ -z "${SUDO_USER:-}" ] && [ -n "${SCHOLARIO_RELEASE_CONF:-}" ]; then CONF_FILE="$SCHOLARIO_RELEASE_CONF"; fi
if [ -f "$CONF_FILE" ]; then
  # shellcheck source=/dev/null
  . "$CONF_FILE"
fi
APP_NAME="${APP_NAME:-scholario-ops}"
APP_HOME="${APP_HOME:-/var/www/scholario-ops}"
RELEASES_DIR="${RELEASES_DIR:-/var/www/scholario-ops-releases}"
INCOMING_DIR="${INCOMING_DIR:-/home/scholario-deploy/incoming}"
APP_PORT="${APP_PORT:-4100}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://scholario-ops.bylinelearning.cloud/api/health/live}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-12}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"            # successful releases kept (never fewer than 3)
KEEP_FAILED="${KEEP_FAILED:-2}"                # failed releases kept for diagnosis
PRE_DEPLOY_BACKUP="${PRE_DEPLOY_BACKUP:-always}"  # always | never  (pg_dump of the ops schema via deploy/backup-db.sh)
PM2_HOME="${PM2_HOME:-/root/.pm2}"             # PM2 daemon that owns the scholario-ops process
EXTRA_PATH="${EXTRA_PATH:-}"                   # e.g. the bin dir of an nvm-installed Node
LOCK_FILE="${LOCK_FILE:-/var/lock/scholario-ops-deploy.lock}"
[ "$KEEP_RELEASES" -ge 3 ] 2>/dev/null || KEEP_RELEASES=3

export PM2_HOME
[ -n "$EXTRA_PATH" ] && export PATH="$EXTRA_PATH:$PATH"
CURRENT="$RELEASES_DIR/current"
LOCAL_BASE="http://127.0.0.1:$APP_PORT"
OK_MARK=.deploy-ok
FAIL_MARK=.deploy-failed

# Survive a dropped SSH connection (e.g. a cancelled GitHub job): ignore SIGHUP and keep going.
trap '' HUP

ts()   { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
say()  { printf '[%s] %s\n' "$(ts)" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$(ts)" "$*"; }
die()  { printf '[%s] ERROR: %s\n' "$(ts)" "$*"; exit 1; }
hr()   { printf -- '----------------------------------------------------------------------\n'; }

audit() {  # one line per deploy/rollback outcome, kept next to the releases
  printf '%s\t%s\t%s\t%s\t%s\n' "$(ts)" "$1" "$2" "${SUDO_USER:-$(id -un)}" "$3" >> "$RELEASES_DIR/deployments.log" 2>/dev/null || true
}

require_tools() {
  local t
  for t in "$@"; do command -v "$t" >/dev/null 2>&1 || die "required command not found: $t (PATH=$PATH)"; done
}

pm2_ready() {  # never let a typo'd PM2_HOME spawn a fresh, empty PM2 daemon
  [ -f "$PM2_HOME/pm2.pid" ] || die "no PM2 daemon at PM2_HOME=$PM2_HOME — set PM2_HOME in $CONF_FILE to the home of the user that runs '$APP_NAME'"
  pm2 describe "$APP_NAME" >/dev/null 2>&1 || die "PM2 process '$APP_NAME' not found under PM2_HOME=$PM2_HOME (see docs/CI-CD.md → one-time cutover)"
}

pm2_pid() { pm2 pid "$APP_NAME" 2>/dev/null | tr -dc '0-9' || true; }

live_release() { [ -L "$CURRENT" ] && basename "$(readlink "$CURRENT")" || true; }

switch_to() {  # atomic symlink swap: current -> <release>
  local target="$1"
  ln -sfn "$target" "$RELEASES_DIR/.current.tmp"
  mv -Tf "$RELEASES_DIR/.current.tmp" "$CURRENT"
}

# ── Health checks ──
# check_url <name> <url> [body-substring]: 200 (and the substring, if given) within HEALTH_ATTEMPTS × HEALTH_INTERVAL
check_url() {
  local name="$1" url="$2" want="${3:-}" i code body tmp
  tmp="$(mktemp)"
  for ((i = 1; i <= HEALTH_ATTEMPTS; i++)); do
    code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)"
    body="$(head -c 400 "$tmp" 2>/dev/null || true)"
    if [ "$code" = 200 ] && { [ -z "$want" ] || grep -q "$want" "$tmp"; }; then
      say "  ✓ $name ($url) — HTTP 200 on attempt $i"
      rm -f "$tmp"; return 0
    fi
    say "  … $name attempt $i/$HEALTH_ATTEMPTS: HTTP ${code:-none} ${body:+— $body}"
    [ "$i" -lt "$HEALTH_ATTEMPTS" ] && sleep "$HEALTH_INTERVAL"
  done
  rm -f "$tmp"
  say "  ✗ $name failed after $HEALTH_ATTEMPTS attempts"
  return 1
}

# Port APP_PORT must be bound to loopback only — never to 0.0.0.0 / [::]
check_loopback_only() {
  command -v ss >/dev/null 2>&1 || { warn "ss not available — skipping listen-address check"; return 0; }
  local addrs
  addrs="$(ss -Hltn "sport = :$APP_PORT" 2>/dev/null | awk '{print $4}')"
  if [ -z "$addrs" ]; then say "  ✗ nothing is listening on port $APP_PORT"; return 1; fi
  if printf '%s\n' "$addrs" | grep -Evq "^(127\.0\.0\.1|\[::1\]):$APP_PORT$"; then
    say "  ✗ port $APP_PORT is exposed beyond loopback: $(printf '%s ' "$addrs")"; return 1
  fi
  say "  ✓ port $APP_PORT bound to loopback only ($(printf '%s ' "$addrs"))"
}

health_checks() {
  check_url "local liveness"  "$LOCAL_BASE/api/health/live"  '"status":"alive"' &&
  check_url "local readiness (app + database)" "$LOCAL_BASE/api/health/ready" '"status":"ready"' &&
  check_loopback_only &&
  check_url "public liveness" "$PUBLIC_HEALTH_URL" '"status":"alive"'
}

diagnostics() {
  hr; say "DIAGNOSTICS"
  say "current -> $(readlink "$CURRENT" 2>/dev/null || echo '(none)')"
  pm2 describe "$APP_NAME" 2>/dev/null | grep -E 'status|restarts|uptime|script path|exec cwd|pid|node.js version' || true
  say "pm2 list:"; pm2 list --no-color 2>/dev/null || true
  say "recent logs ($APP_NAME):"; pm2 logs "$APP_NAME" --lines 60 --nostream --raw 2>/dev/null | tail -n 120 || true
  hr
}

restart_app() {
  say "pm2 restart $APP_NAME --update-env"
  pm2 restart "$APP_NAME" --update-env
}

# ── Retention ──
# Keeps the newest KEEP_RELEASES successful releases (always including the live and the previous one)
# and the newest KEEP_FAILED failed/incomplete ones; deletes the rest.
prune() {
  local live prev d name n_ok=0 n_bad=0
  live="$(live_release)"; prev="${1:-}"
  if [ -n "$live" ] && [ -f "$RELEASES_DIR/$live/$OK_MARK" ]; then n_ok=$((n_ok + 1)); fi
  if [ -n "$prev" ] && [ "$prev" != "$live" ] && [ -f "$RELEASES_DIR/$prev/$OK_MARK" ]; then n_ok=$((n_ok + 1)); fi
  while IFS= read -r d; do
    name="$(basename "$d")"
    if [ "$name" = "$live" ] || [ "$name" = "$prev" ]; then continue; fi
    if [ -f "$d/$OK_MARK" ]; then
      if [ "$n_ok" -lt "$KEEP_RELEASES" ]; then n_ok=$((n_ok + 1)); continue; fi
    else
      if [ "$n_bad" -lt "$KEEP_FAILED" ]; then n_bad=$((n_bad + 1)); continue; fi
    fi
    say "  prune: removing old release $name"
    rm -rf --one-file-system -- "$d"
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r)
}

# ── Commands ──
cmd_deploy() {
  local sha="${1:-}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "usage: $0 deploy <40-char git sha>"
  require_tools node npm pm2 curl tar sha256sum flock
  [ -d "$APP_HOME" ] || die "APP_HOME $APP_HOME does not exist"
  [ -f "$APP_HOME/.env" ] || die "$APP_HOME/.env is missing — refusing to deploy (it is never created or changed by CI)"
  [ -L "$CURRENT" ] || die "$CURRENT is not set up yet — do the one-time cutover in docs/CI-CD.md first"
  pm2_ready

  local node_major; node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$node_major" -ge 20 ] || die "Node $node_major on the server; Scholario Ops needs 20+ (22 recommended)"

  local tarball="$INCOMING_DIR/scholario-ops-$sha.tar.gz" sumfile="$INCOMING_DIR/scholario-ops-$sha.tar.gz.sha256"
  [ -f "$tarball" ] && [ -f "$sumfile" ] || die "artifact not found: $tarball (+ .sha256)"

  local prev prev_dir id new stage
  prev="$(live_release)"; prev_dir="$RELEASES_DIR/$prev"
  [ -d "$prev_dir/dist-server" ] || die "current release '$prev' is not a valid release directory"
  id="$(date -u +%Y%m%d-%H%M%S)-${sha:0:7}"
  new="$RELEASES_DIR/$id"
  stage="$RELEASES_DIR/.staging-$id"

  hr; say "DEPLOY $APP_NAME  commit=$sha  release=$id"; say "previous (known-good) release: $prev"; hr

  # 1. Copy the artifact out of the deploy user's directory, then verify that copy (no swap after the check)
  mkdir -p "$stage"; chmod 700 "$stage"
  cp -- "$tarball" "$stage/release.tar.gz"
  local want got; want="$(awk '{print $1}' "$sumfile")"; got="$(sha256sum "$stage/release.tar.gz" | awk '{print $1}')"
  [ -n "$want" ] && [ "$want" = "$got" ] || { rm -rf "$stage"; die "artifact checksum mismatch"; }
  say "artifact checksum OK ($got)"

  # 2. Only plain files and directories, no absolute paths, no '..'
  if tar -tzvf "$stage/release.tar.gz" | awk '{print substr($1,1,1)}' | grep -qv '[-d]' ||
     tar -tzf "$stage/release.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    rm -rf "$stage"; die "artifact contains links, absolute paths or '..' — refusing it"
  fi

  # 3. Prepare the new release next to the live one (live release untouched)
  mkdir -p "$new"
  tar -xzf "$stage/release.tar.gz" -C "$new" --no-same-owner --no-same-permissions
  rm -rf "$stage"
  [ "$(cat "$new/REVISION" 2>/dev/null)" = "$sha" ] || { touch "$new/$FAIL_MARK"; die "REVISION in artifact does not match $sha"; }
  local f
  for f in dist/index.html dist-server/server.js package.json package-lock.json; do
    [ -f "$new/$f" ] || { touch "$new/$FAIL_MARK"; die "artifact is missing $f"; }
  done
  ls "$new"/dist-server/migrations/*.sql >/dev/null 2>&1 || { touch "$new/$FAIL_MARK"; die "artifact has no dist-server/migrations"; }

  say "installing production dependencies (npm ci --omit=dev)"
  (cd "$new" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error) || { touch "$new/$FAIL_MARK"; die "npm ci failed — live release untouched"; }
  node --check "$new/dist-server/server.js" || { touch "$new/$FAIL_MARK"; die "server bundle failed syntax check — live release untouched"; }
  say "build validated"

  # 4. Report migrations this release adds (the app applies them at startup; they are NOT rolled back automatically)
  local new_migs
  new_migs="$(comm -13 <(find "$prev_dir/dist-server/migrations" -maxdepth 1 -name '*.sql' -printf '%f\n' 2>/dev/null | sort) \
                       <(find "$new/dist-server/migrations" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort) | tr '\n' ' ')"
  new_migs="${new_migs% }"
  if [ -n "${new_migs// /}" ]; then
    warn "this release adds database migrations: $new_migs — they run automatically when the new release starts and are NOT reverted by a rollback"
  else
    say "no new database migrations in this release"
  fi

  # 5. Database backup before switching
  if [ "$PRE_DEPLOY_BACKUP" = always ]; then
    say "pre-deploy database backup"
    APP_DIR="$APP_HOME" bash "$new/deploy/backup-db.sh" || { touch "$new/$FAIL_MARK"; die "pre-deploy backup failed — live release untouched"; }
  fi

  # 6. Switch + restart. From here on, any failure rolls back to $prev.
  local old_pid new_pid
  old_pid="$(pm2_pid)"
  say "switching current -> $id"
  switch_to "$id"
  # shellcheck disable=SC2064
  trap "say 'interrupted after switch — rolling back'; rollback_to '$prev' '$id' 'interrupted'; exit 3" INT TERM

  local ok=1
  restart_app || { say "pm2 restart returned an error"; ok=0; }
  if [ "$ok" = 1 ]; then
    new_pid="$(pm2_pid)"
    if [ -z "$new_pid" ] || [ "$new_pid" = 0 ] || [ "$new_pid" = "$old_pid" ]; then
      say "PM2 process did not restart (pid before=$old_pid after=${new_pid:-none})"; ok=0
    else
      say "new process pid $new_pid (was $old_pid)"
    fi
  fi
  say "health checks (every ${HEALTH_INTERVAL}s, max $HEALTH_ATTEMPTS attempts each)"
  [ "$ok" = 1 ] && health_checks || ok=0

  if [ "$ok" = 1 ]; then
    trap - INT TERM
    touch "$new/$OK_MARK"
    if pm2 save >/dev/null; then say "pm2 save done"; else warn "pm2 save failed — run it by hand"; fi
    audit deploy "$id" "success $sha"
    say "retention: keeping the last $KEEP_RELEASES successful releases"
    prune "$prev"
    hr; say "DEPLOY SUCCEEDED — live release $id ($sha)"; hr
    return 0
  fi

  hr; say "DEPLOY FAILED — release $id did not pass health checks"
  diagnostics
  trap - INT TERM
  if rollback_to "$prev" "$id" "health checks failed"; then
    [ -n "${new_migs// /}" ] && warn "DATABASE NOT ROLLED BACK: migrations $new_migs may have been applied by the failed release. Code is back on $prev. Restore from the pre-deploy backup only if $prev cannot work with the new schema (docs/CI-CD.md)."
    exit 1
  fi
  exit 2
}

# rollback_to <release> <failed-release|''> <reason>
rollback_to() {
  local target="$1" failed="${2:-}" reason="${3:-manual}"
  [ -n "$target" ] && [ -d "$RELEASES_DIR/$target/dist-server" ] || { say "ROLLBACK IMPOSSIBLE: release '$target' not found"; audit rollback "${target:-?}" "FAILED (missing) $reason"; return 1; }
  hr; say "ROLLBACK -> $target ($reason)"
  [ -n "$failed" ] && [ -d "$RELEASES_DIR/$failed" ] && touch "$RELEASES_DIR/$failed/$FAIL_MARK" && rm -f "$RELEASES_DIR/$failed/$OK_MARK"
  switch_to "$target"
  if restart_app && health_checks; then
    audit rollback "$target" "success ($reason)${failed:+ failed=$failed}"
    hr; say "ROLLBACK SUCCEEDED — live release $target"; hr
    return 0
  fi
  diagnostics
  audit rollback "$target" "FAILED ($reason)${failed:+ failed=$failed}"
  hr; say "ROLLBACK FAILED — production needs manual attention (docs/CI-CD.md → Emergency manual rollback)"; hr
  return 1
}

cmd_rollback() {
  require_tools pm2 curl flock
  [ -L "$CURRENT" ] || die "$CURRENT does not exist"
  pm2_ready
  local live target="${1:-}"
  live="$(live_release)"
  if [ -z "$target" ]; then  # newest successful release that is not the live one
    target="$(find "$RELEASES_DIR" -mindepth 2 -maxdepth 2 -name "$OK_MARK" -printf '%h\n' | xargs -rn1 basename | grep -vx "$live" | sort -r | head -1 || true)"
  fi
  [[ "$target" =~ ^[0-9A-Za-z._-]+$ ]] || die "no previous successful release to roll back to"
  [ "$target" != "$live" ] || die "$target is already live"
  rollback_to "$target" "" "manual rollback from $live" || exit 2
}

cmd_status() {
  local d mark live
  live="$(live_release)"
  say "live release: ${live:-(none)}  ($CURRENT)"
  [ -n "$live" ] && [ -f "$RELEASES_DIR/$live/REVISION" ] && say "live commit:  $(cat "$RELEASES_DIR/$live/REVISION")"
  say "releases (newest first):"
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    mark="incomplete"; [ -f "$d/$OK_MARK" ] && mark="ok"; [ -f "$d/$FAIL_MARK" ] && mark="FAILED"
    printf '  %-28s %-10s %s\n' "$(basename "$d")" "$mark" "$([ "$(basename "$d")" = "$live" ] && echo '<- live')"
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' 2>/dev/null | sort -r)
  [ -f "$RELEASES_DIR/deployments.log" ] && { say "recent deployments:"; tail -n 10 "$RELEASES_DIR/deployments.log"; }
  if [ -f "$PM2_HOME/pm2.pid" ]; then pm2 describe "$APP_NAME" 2>/dev/null | grep -E 'status|restarts|uptime|script path' || true; fi
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    deploy|rollback)
      mkdir -p "$RELEASES_DIR" "$RELEASES_DIR/logs"
      exec 9>"$LOCK_FILE"
      flock -n 9 || die "another deployment/rollback is running (lock $LOCK_FILE)"
      # Full transcript per run; tee ignores a closed SSH pipe so the run always completes
      local logf; logf="$RELEASES_DIR/logs/$(date -u +%Y%m%d-%H%M%S)-$cmd.log"
      exec > >(tee -p -a "$logf") 2>&1
      say "transcript: $logf"
      if [ "$cmd" = deploy ]; then cmd_deploy "$@"; else cmd_rollback "$@"; fi
      ;;
    status) cmd_status ;;
    *) printf 'usage: %s deploy <git-sha> | rollback [release-id] | status\n' "$0"; exit 64 ;;
  esac
}

main "$@"
