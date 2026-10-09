#!/usr/bin/env bash
# Scholario Ops — PostgreSQL backup of the "ops" schema (configuration + history).
#
#   ./deploy/backup-db.sh                       # writes backups/ops-YYYYmmdd-HHMMSS.sql.gz
#   crontab -e  →  15 2 * * * /var/www/scholario-ops/deploy/backup-db.sh >> /var/www/scholario-ops/logs/backup.log 2>&1
#
# Reads DATABASE_URL and DB_SCHEMA from the app's .env. Keeps the last KEEP_DAYS days (default 14).
# Restore:  gunzip -c backups/ops-XXXX.sql.gz | psql "$DATABASE_URL"
set -euo pipefail

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
DATABASE_URL="$(read_env DATABASE_URL)"
DB_SCHEMA="$(read_env DB_SCHEMA)"
DB_SCHEMA="${DB_SCHEMA:-ops}"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL is empty in .env" >&2; exit 1; }
[[ "$DB_SCHEMA" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "DB_SCHEMA is not a valid schema name" >&2; exit 1; }

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

KEEP_DAYS="${KEEP_DAYS:-14}"
OUT_DIR="$APP_DIR/backups"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

FILE="$OUT_DIR/${DB_SCHEMA}-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump --schema="$DB_SCHEMA" --no-owner --no-privileges | gzip -9 > "$FILE"
chmod 600 "$FILE"
find "$OUT_DIR" -name "${DB_SCHEMA}-*.sql.gz" -mtime +"$KEEP_DAYS" -delete

echo "$(date '+%F %T') backup written: $FILE ($(du -h "$FILE" | cut -f1))"
