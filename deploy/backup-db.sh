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

DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_SCHEMA="$(grep -E '^DB_SCHEMA=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_SCHEMA="${DB_SCHEMA:-ops}"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL is empty in .env" >&2; exit 1; }

KEEP_DAYS="${KEEP_DAYS:-14}"
OUT_DIR="$APP_DIR/backups"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

FILE="$OUT_DIR/${DB_SCHEMA}-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump --schema="$DB_SCHEMA" --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
chmod 600 "$FILE"
find "$OUT_DIR" -name "${DB_SCHEMA}-*.sql.gz" -mtime +"$KEEP_DAYS" -delete

echo "$(date '+%F %T') backup written: $FILE ($(du -h "$FILE" | cut -f1))"
