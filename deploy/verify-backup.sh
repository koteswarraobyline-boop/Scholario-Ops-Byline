#!/usr/bin/env bash
# Scholario Ops — restore test: proves the newest backup (or the one given) can really be restored.
#
#   ./deploy/verify-backup.sh                      # newest backups/ops-*.sql.gz[.age|.gpg]
#   ./deploy/verify-backup.sh backups/ops-20261010-021500.sql.gz.age
#   crontab -e  →  45 3 * * 0 /var/www/scholario-ops/deploy/verify-backup.sh >> /var/www/scholario-ops/logs/backup.log 2>&1
#
# Restores into a SEPARATE scratch database, never into production:
#   BACKUP_VERIFY_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/scholario_restore_test
# The script refuses to run when that URL points at the same database as DATABASE_URL.
# Steps: checksum (<file>.sha256) → decrypt if needed → DROP + restore the schema in a single
# transaction (stops at the first error) → compare every table's row count with the dump →
# drop the restored schema again → write backups/last-restore-test.json (shown and alerted on by the app).
#
# Encrypted backups need the private key here:
#   age: BACKUP_AGE_IDENTITY=/root/.config/scholario/backup-age-key.txt (mode 0400)
#   gpg: the secret key in root's keyring
# Settings come from the environment first, then the app's .env. Exit code 0 = VERIFIED.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "No .env in $APP_DIR" >&2; exit 1; }
read_env() {
  grep -E "^(export[[:space:]]+)?$1=" "$ENV_FILE" | head -1 \
    | sed -E "s/^(export[[:space:]]+)?$1=//; s/^[\"']//; s/[\"'][[:space:]]*\$//" || true
}
cfg() { local v="${!1:-}"; [ -n "$v" ] || v="$(read_env "$1")"; printf '%s' "$v"; }

DATABASE_URL="$(read_env DATABASE_URL)"
DB_SCHEMA="$(read_env DB_SCHEMA)"; DB_SCHEMA="${DB_SCHEMA:-ops}"
VERIFY_URL="$(cfg BACKUP_VERIFY_DATABASE_URL)"
AGE_IDENTITY="$(cfg BACKUP_AGE_IDENTITY)"
[[ "$DB_SCHEMA" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "DB_SCHEMA is not a valid schema name" >&2; exit 1; }

OUT_DIR="$APP_DIR/backups"
STATUS_FILE="$OUT_DIR/last-restore-test.json"
STARTED_MS="$(date +%s)"
WORK=""
FILE="${1:-}"

write_status() {
  RT_STATUS="$1" RT_ERROR="${2:-}" RT_FILE="${FILE:-}" RT_RESULTS="${RESULTS:-}" RT_STARTED="$STARTED_MS" \
  node -e '
    const e = process.env;
    const tables = {};
    for (const line of (e.RT_RESULTS || "").split("\n").filter(Boolean)) {
      const [t, expected, restored] = line.split(" ");
      tables[t] = { expected: Number(expected), restored: Number(restored) };
    }
    console.log(JSON.stringify({
      status: e.RT_STATUS, error: e.RT_ERROR || null, testedAt: new Date().toISOString(),
      durationSec: Math.max(0, Math.round(Date.now() / 1000 - Number(e.RT_STARTED))),
      file: e.RT_FILE ? require("path").basename(e.RT_FILE) : null, tables,
    }, null, 2));
  ' > "$STATUS_FILE.tmp" && mv -f "$STATUS_FILE.tmp" "$STATUS_FILE" || echo "could not write $STATUS_FILE" >&2
}
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; return 0; }
die() {
  trap - ERR
  cleanup
  write_status FAILED "$1"
  echo "$(date '+%F %T') RESTORE TEST FAILED: $1" >&2
  exit 1
}
trap cleanup EXIT
trap 'die "unexpected error (line $LINENO)"' ERR
mkdir -p "$OUT_DIR"

[ -n "$VERIFY_URL" ] || die "BACKUP_VERIFY_DATABASE_URL is not set (a scratch database for the restore test)"

# Never the production database: compare host, port and database name
SAME="$(A="$DATABASE_URL" B="$VERIFY_URL" node -e '
  const k = s => { try { const u = new URL(s); return [u.hostname.replace(/^localhost$/, "127.0.0.1"), u.port || "5432", decodeURIComponent(u.pathname.replace(/^\//, ""))].join("|"); } catch { return "invalid:" + s.length; } };
  console.log(process.env.A && k(process.env.A) === k(process.env.B) ? "same" : k(process.env.B).startsWith("invalid") ? "invalid" : "different");
')"
[ "$SAME" = different ] || die "BACKUP_VERIFY_DATABASE_URL must be a valid URL of a different database than DATABASE_URL (got: $SAME)"

if [ -z "$FILE" ]; then
  FILE="$(ls -1t "$OUT_DIR/${DB_SCHEMA}"-*.sql.gz "$OUT_DIR/${DB_SCHEMA}"-*.sql.gz.age "$OUT_DIR/${DB_SCHEMA}"-*.sql.gz.gpg 2>/dev/null | head -1 || true)"
fi
[ -n "$FILE" ] && [ -f "$FILE" ] || die "no backup file found in $OUT_DIR"

# Checksum written by backup-db.sh
if [ -f "$FILE.sha256" ]; then
  [ "$(sha256sum < "$FILE" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$FILE.sha256")" ] || die "checksum mismatch: $(basename "$FILE") is corrupted"
fi

WORK="$(mktemp -d)"
PLAIN="$WORK/dump.sql"
case "$FILE" in
  *.age) [ -n "$AGE_IDENTITY" ] || die "the backup is age-encrypted: set BACKUP_AGE_IDENTITY to the private key file"
         command -v age >/dev/null || die "age is not installed"
         age -d -i "$AGE_IDENTITY" "$FILE" | gzip -dc > "$PLAIN" || die "could not decrypt $(basename "$FILE")" ;;
  *.gpg) gpg --batch --quiet --decrypt "$FILE" | gzip -dc > "$PLAIN" || die "could not decrypt $(basename "$FILE")" ;;
  *)     gzip -dc "$FILE" > "$PLAIN" || die "could not decompress $(basename "$FILE")" ;;
esac
grep -q 'PostgreSQL database dump complete' "$PLAIN" || die "dump is incomplete (no pg_dump completion trailer)"

# The dump is for the schema configured here
grep -qE "^CREATE SCHEMA ${DB_SCHEMA};" "$PLAIN" || die "the dump does not contain schema $DB_SCHEMA"

EXPECTED="$(awk '
  /^COPY / { t = $2; n = 0; inblk = 1; next }
  inblk && $0 == "\\." { print t, n; inblk = 0; next }
  inblk { n++ }
' "$PLAIN")"
[ -n "$EXPECTED" ] || die "the dump contains no tables"

# Scratch connection through PG* variables (never on the command line)
eval "$(DATABASE_URL="$VERIFY_URL" node -e '
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

PSQL=(psql -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "DROP SCHEMA IF EXISTS \"$DB_SCHEMA\" CASCADE" >/dev/null || die "cannot connect to the scratch database"
"${PSQL[@]}" --single-transaction -f "$PLAIN" > "$WORK/restore.log" 2>&1 \
  || die "restore failed: $(grep -m1 -i error "$WORK/restore.log" | cut -c1-200)"

RESULTS=""
MISMATCH=""
while read -r table expected; do
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$ ]] || die "unexpected table name in dump: $table"
  restored="$("${PSQL[@]}" -t -A -c "SELECT count(*) FROM $table")" || die "cannot count rows of $table"
  RESULTS+="$table $expected $restored"$'\n'
  [ "$restored" = "$expected" ] || MISMATCH+="$table: dump $expected, restored $restored; "
done <<< "$EXPECTED"

"${PSQL[@]}" -c "DROP SCHEMA IF EXISTS \"$DB_SCHEMA\" CASCADE" >/dev/null || echo "warning: could not drop the restored schema in the scratch database" >&2
[ -z "$MISMATCH" ] || die "row counts differ — $MISMATCH"

trap - ERR
write_status VERIFIED
TABLES="$(grep -c . <<< "$EXPECTED")"
echo "$(date '+%F %T') restore test VERIFIED: $(basename "$FILE") ($TABLES tables, $(( $(date +%s) - STARTED_MS ))s)"
