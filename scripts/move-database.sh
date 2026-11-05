#!/usr/bin/env bash
# Move VolunTrack's database to a new Postgres (#725), e.g. a new Neon project.
#
#   bash scripts/move-database.sh
#
# The old address comes from OLD_DATABASE_URL, else DATABASE_URL in .env.local.
# The new one is typed at a hidden prompt (or NEW_DATABASE_URL), never shown.
# Turn on MAINTENANCE_MODE=1 on Render first, so nothing is written meanwhile.
# Refuses to copy into a database that already has tables. Copies schema and
# data, then compares the row count of every table. Nothing is changed in the
# old database. The temporary copy is deleted at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=/opt/homebrew/opt/libpq/bin
[ -x "$BIN/pg_dump" ] || BIN="$(dirname "$(command -v pg_dump)")"
echo "Using $("$BIN/pg_dump" --version)"

OLD="${OLD_DATABASE_URL:-}"
if [ -z "$OLD" ] && [ -f .env.local ]; then
  OLD="$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d "\"'")"
fi
[ -n "$OLD" ] || { echo "No old database address (OLD_DATABASE_URL or DATABASE_URL in .env.local)."; exit 1; }

NEW="${NEW_DATABASE_URL:-}"
if [ -z "$NEW" ]; then
  read -r -s -p "Paste the NEW database connection string (hidden), then press Enter: " NEW
  echo
fi
[ -n "$NEW" ] || { echo "No new address given."; exit 1; }
[ "$OLD" != "$NEW" ] || { echo "Old and new are the same database. Stopping."; exit 1; }

host() { echo "$1" | sed -E 's#^[a-z]+://[^@]*@([^/:?]+).*#\1#'; }
echo "From: $(host "$OLD")"
echo "To:   $(host "$NEW")"

TABLES_NEW=$("$BIN/psql" "$NEW" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$TABLES_NEW" != "0" ]; then
  echo "The new database already has $TABLES_NEW tables. It must be empty. Stopping."
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "1/3 Copying out of the old database…"
"$BIN/pg_dump" --format=custom --no-owner --no-privileges --file="$TMP/voluntrack.dump" "$OLD"
echo "    $(du -h "$TMP/voluntrack.dump" | cut -f1) copied."

echo "2/3 Loading into the new database…"
"$BIN/pg_restore" --no-owner --no-privileges --dbname="$NEW" "$TMP/voluntrack.dump" \
  || echo "    pg_restore reported warnings (shown above); the table check below decides."

echo "3/3 Comparing every table…"
COUNT_SQL="select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
bad=0; total=0
while read -r t; do
  [ -n "$t" ] || continue
  a=$("$BIN/psql" "$OLD" -Atc "select count(*) from public.\"$t\"")
  b=$("$BIN/psql" "$NEW" -Atc "select count(*) from public.\"$t\"" 2>/dev/null || echo missing)
  total=$((total + 1))
  if [ "$a" != "$b" ]; then bad=$((bad + 1)); printf '  DIFFERENT  %-40s old=%s new=%s\n' "$t" "$a" "$b"; fi
done < <("$BIN/psql" "$OLD" -Atc "$COUNT_SQL")
if [ "$bad" = "0" ]; then
  echo "All $total tables match row for row. ✅"
  echo "Next: put the NEW connection string into DATABASE_URL on Render, remove MAINTENANCE_MODE, and save."
else
  echo "$bad of $total tables differ. ❌ Don't switch Render yet."
  exit 1
fi
