#!/usr/bin/env bash
# Scholario Ops — PostgreSQL backup of the "ops" schema (configuration + history).
#
#   ./deploy/backup-db.sh                       # writes backups/ops-YYYYmmdd-HHMMSS.sql.gz[.age|.gpg]
#   crontab -e  →  15 2 * * * /var/www/scholario-ops/deploy/backup-db.sh >> /var/www/scholario-ops/logs/backup.log 2>&1
#
# Every run:
#   1. pg_dump → gzip, then proves the file is usable: gzip integrity test + pg_dump's
#      "dump complete" trailer (a dump cut short by a crash or full disk is rejected).
#   2. Counts the rows of every table in the dump (used later by deploy/verify-backup.sh).
#   3. Optional encryption with a PUBLIC key (the server can write backups but not read them):
#        BACKUP_AGE_RECIPIENT=age1...            (age; a file of recipients also works)
#        BACKUP_GPG_RECIPIENT=ops-backup@example (gpg; the public key must be in root's keyring)
#   4. SHA-256 checksum next to the file (<file>.sha256).
#   5. Optional off-server copy over SSH (e.g. to the DR node), verified by checksum on the far side:
#        BACKUP_REMOTE=backup@dr-host:/var/backups/scholario-ops
#        BACKUP_SSH_KEY=/root/.ssh/scholario_backup   BACKUP_SSH_PORT=22   BACKUP_REMOTE_KEEP_DAYS=30
#      The remote host key must already be in known_hosts (StrictHostKeyChecking=yes).
#   6. Writes backups/last-backup.json — the Ops app reads it, shows it on the Backups page and
#      alerts when the backup failed, is stale or the off-server copy failed.
#
# Settings come from the environment first, then the app's .env. Nothing is sent anywhere unless
# BACKUP_REMOTE is set. Exit code: 0 = local backup good (an off-server copy failure is reported in
# last-backup.json and on stderr, it does not block a deploy), 1 = no usable backup was written.
#
# Restore:  gunzip -c backups/ops-XXXX.sql.gz | psql "$DATABASE_URL"
#           (encrypted: age -d -i key.txt FILE.age | gunzip | psql …   or   gpg -d FILE.gpg | gunzip | psql …)
# Test a restore without touching production: deploy/verify-backup.sh
set -euo pipefail
umask 077

# APP_DIR (the directory holding .env and backups/) defaults to the checkout this script is in;
# the release manager (deploy/release.sh) sets it to /var/www/scholario-ops.
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "No .env in $APP_DIR" >&2; exit 1; }

# KEY=value from .env, tolerating an "export " prefix and surrounding quotes
read_env() {
  grep -E "^(export[[:space:]]+)?$1=" "$ENV_FILE" | head -1 \
    | sed -E "s/^(export[[:space:]]+)?$1=//; s/^[\"']//; s/[\"'][[:space:]]*\$//" || true
}
# Environment wins over .env
cfg() { local v="${!1:-}"; [ -n "$v" ] || v="$(read_env "$1")"; printf '%s' "$v"; }

DATABASE_URL="$(read_env DATABASE_URL)"
DB_SCHEMA="$(read_env DB_SCHEMA)"
DB_SCHEMA="${DB_SCHEMA:-ops}"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL is empty in .env" >&2; exit 1; }
[[ "$DB_SCHEMA" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "DB_SCHEMA is not a valid schema name" >&2; exit 1; }

KEEP_DAYS="${KEEP_DAYS:-$(cfg BACKUP_KEEP_DAYS)}"; KEEP_DAYS="${KEEP_DAYS:-14}"
AGE_RECIPIENT="$(cfg BACKUP_AGE_RECIPIENT)"
GPG_RECIPIENT="$(cfg BACKUP_GPG_RECIPIENT)"
REMOTE="$(cfg BACKUP_REMOTE)"
SSH_KEY="$(cfg BACKUP_SSH_KEY)"
SSH_PORT="$(cfg BACKUP_SSH_PORT)"; SSH_PORT="${SSH_PORT:-22}"
REMOTE_KEEP_DAYS="$(cfg BACKUP_REMOTE_KEEP_DAYS)"; REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-30}"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ && "$REMOTE_KEEP_DAYS" =~ ^[0-9]+$ && "$SSH_PORT" =~ ^[0-9]+$ ]] \
  || { echo "BACKUP_KEEP_DAYS / BACKUP_REMOTE_KEEP_DAYS / BACKUP_SSH_PORT must be numbers" >&2; exit 1; }

OUT_DIR="$APP_DIR/backups"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STATUS_FILE="$OUT_DIR/last-backup.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BASE="${DB_SCHEMA}-$(date +%Y%m%d-%H%M%S)"
TMP="$OUT_DIR/.${BASE}.partial"

# Status for the Ops app, written atomically. Values travel as environment variables (no quoting bugs).
write_status() {
  BK_STATUS="$1" BK_ERROR="${2:-}" BK_STARTED="$STARTED_AT" BK_FILE="${FINAL:-}" BK_SHA="${SHA:-}" \
  BK_ENC="${ENCRYPTION:-none}" BK_COUNTS="${COUNTS:-}" BK_REMOTE="${REMOTE_SAFE:-}" BK_OFF_OK="${OFFSITE_OK:-}" \
  BK_OFF_ERR="${OFFSITE_ERROR:-}" BK_KEEP="$KEEP_DAYS" \
  node -e '
    const e = process.env, fs = require("fs");
    const tables = {};
    for (const kv of (e.BK_COUNTS || "").split(",").filter(Boolean)) { const i = kv.lastIndexOf("="); tables[kv.slice(0, i)] = Number(kv.slice(i + 1)); }
    let sizeBytes = null; try { if (e.BK_FILE) sizeBytes = fs.statSync(e.BK_FILE).size; } catch {}
    console.log(JSON.stringify({
      status: e.BK_STATUS, error: e.BK_ERROR || null, startedAt: e.BK_STARTED, completedAt: new Date().toISOString(),
      file: e.BK_FILE ? require("path").basename(e.BK_FILE) : null, sizeBytes, sha256: e.BK_SHA || null,
      encryption: e.BK_ENC, retentionDays: Number(e.BK_KEEP), tables,
      offsite: e.BK_REMOTE ? { target: e.BK_REMOTE, ok: e.BK_OFF_OK === "true", error: e.BK_OFF_ERR || null } : null,
    }, null, 2));
  ' > "$STATUS_FILE.tmp" && mv -f "$STATUS_FILE.tmp" "$STATUS_FILE" || echo "could not write $STATUS_FILE" >&2
}
die() {
  trap - ERR
  rm -f "$TMP"
  write_status FAILED "$1"
  echo "$(date '+%F %T') BACKUP FAILED: $1" >&2
  exit 1
}
STAGE="setup"
trap 'die "unexpected error during $STAGE (line $LINENO)"' ERR

# Connection details reach pg_dump through PG* environment variables — never through the command
# line, where any local user could read the password (ps, /proc/<pid>/cmdline).
eval "$(DATABASE_URL="$DATABASE_URL" node -e '
  const u = new URL(process.env.DATABASE_URL);
  const q = s => "\x27" + s.replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
  const out = {
    PGHOST: u.hostname, PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
    PGSSLMODE: u.searchParams.get("sslmode") || "",
  };
  for (const [k, v] of Object.entries(out)) if (v) console.log("export " + k + "=" + q(v));
')"

# 1. Dump + prove it is complete
STAGE="pg_dump"
pg_dump --schema="$DB_SCHEMA" --no-owner --no-privileges | gzip -9 > "$TMP" || die "pg_dump failed"
STAGE="integrity check"
gzip -t "$TMP" 2>/dev/null || die "gzip integrity test failed"
TRAILER="$(gzip -dc "$TMP" | tail -n 5)"
[[ "$TRAILER" == *"PostgreSQL database dump complete"* ]] || die "dump is incomplete (no pg_dump completion trailer)"

# 2. Row counts per table (COPY blocks: one line per row until "\.")
STAGE="row count"
COUNTS="$(gzip -dc "$TMP" | awk '
  /^COPY / { t = $2; n = 0; inblk = 1; next }
  inblk && $0 == "\\." { printf "%s%s=%d", sep, t, n; sep = ","; inblk = 0; next }
  inblk { n++ }
')"
[ -n "$COUNTS" ] || die "the dump contains no tables — wrong DB_SCHEMA?"

# 3. Encryption (public key only on this server)
STAGE="encryption"
FINAL="$OUT_DIR/$BASE.sql.gz"
ENCRYPTION=none
if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null || die "BACKUP_AGE_RECIPIENT is set but age is not installed"
  if [ -f "$AGE_RECIPIENT" ]; then age -R "$AGE_RECIPIENT" -o "$FINAL.age" "$TMP" || die "age encryption failed"
  else age -r "$AGE_RECIPIENT" -o "$FINAL.age" "$TMP" || die "age encryption failed"; fi
  FINAL="$FINAL.age"; ENCRYPTION=age
elif [ -n "$GPG_RECIPIENT" ]; then
  command -v gpg >/dev/null || die "BACKUP_GPG_RECIPIENT is set but gpg is not installed"
  gpg --batch --yes --quiet --trust-model always --recipient "$GPG_RECIPIENT" --output "$FINAL.gpg" --encrypt "$TMP" || die "gpg encryption failed"
  FINAL="$FINAL.gpg"; ENCRYPTION=gpg
else
  mv -f "$TMP" "$FINAL"
fi
rm -f "$TMP"
chmod 600 "$FINAL"

# 4. Checksum
STAGE="checksum"
SHA="$(sha256sum < "$FINAL" | cut -d' ' -f1)"  # from stdin: GNU sha256sum prefixes a backslash for odd file names
printf '%s  %s\n' "$SHA" "$(basename "$FINAL")" > "$FINAL.sha256"
chmod 600 "$FINAL.sha256"

# 5. Off-server copy, verified on the far side. A failure is reported, never fatal.
OFFSITE_OK=""; OFFSITE_ERROR=""; REMOTE_SAFE=""
if [ -n "$REMOTE" ]; then
  STAGE="off-server copy"
  # user@host:/absolute/path only — the path is used inside a remote shell command
  if [[ ! "$REMOTE" =~ ^([A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:/[A-Za-z0-9._/-]+$ ]]; then
    OFFSITE_OK=false; OFFSITE_ERROR="BACKUP_REMOTE must look like user@host:/absolute/path"
    REMOTE_SAFE="(invalid BACKUP_REMOTE)"  # the raw value is not echoed back
  else
    RHOST="${REMOTE%%:*}"; RDIR="${REMOTE#*:}"; RDIR="${RDIR%/}"
    REMOTE_SAFE="$REMOTE"
    SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes)
    [ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
    NAME="$(basename "$FINAL")"
    if ! OUT="$(ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" "$RHOST" "mkdir -p '$RDIR' && chmod 700 '$RDIR'" 2>&1)"; then
      OFFSITE_OK=false; OFFSITE_ERROR="ssh to $RHOST failed: ${OUT:0:200}"
    elif ! OUT="$(scp -q "${SSH_OPTS[@]}" -P "$SSH_PORT" "$FINAL" "$FINAL.sha256" "$RHOST:$RDIR/" 2>&1)"; then
      OFFSITE_OK=false; OFFSITE_ERROR="copy to $RHOST failed: ${OUT:0:200}"
    else
      RSHA="$(ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" "$RHOST" "sha256sum < '$RDIR/$NAME'" 2>/dev/null | cut -d' ' -f1 || true)"
      if [ "$RSHA" = "$SHA" ]; then
        OFFSITE_OK=true
        ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" "$RHOST" \
          "find '$RDIR' -maxdepth 1 -type f -name '${DB_SCHEMA}-*.sql.gz*' -mtime +$REMOTE_KEEP_DAYS -delete" 2>/dev/null \
          || echo "warning: remote retention cleanup failed on $RHOST" >&2
      else
        OFFSITE_OK=false; OFFSITE_ERROR="checksum mismatch on $RHOST after copy (got '${RSHA:-nothing}')"
      fi
    fi
  fi
fi

# Local retention (backup, checksum) + leftovers of interrupted runs
STAGE="retention"
find "$OUT_DIR" -maxdepth 1 -type f -name "${DB_SCHEMA}-*.sql.gz*" -mtime +"$KEEP_DAYS" -delete
find "$OUT_DIR" -maxdepth 1 -type f -name ".${DB_SCHEMA}-*.partial" -mmin +60 -delete

trap - ERR
write_status SUCCESS
echo "$(date '+%F %T') backup written: $FINAL ($(du -h "$FINAL" | cut -f1), encryption: $ENCRYPTION, sha256 ${SHA:0:12}…)"
if [ "$OFFSITE_OK" = false ]; then
  echo "$(date '+%F %T') WARNING: off-server copy failed: $OFFSITE_ERROR" >&2
elif [ "$OFFSITE_OK" = true ]; then
  echo "$(date '+%F %T') off-server copy verified on ${REMOTE%%:*}"
fi
exit 0
