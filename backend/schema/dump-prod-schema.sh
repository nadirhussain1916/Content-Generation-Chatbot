#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dump-prod-schema.sh
#
# Fetches the CREATE TABLE / CREATE INDEX SQL for every object in the
# production Cloudflare D1 database and writes one file per table into
# backend/schema/.
#
# Usage (run from anywhere inside the repo):
#   bash backend/schema/dump-prod-schema.sh
#   npm run update-schema   (from backend/)
#
# Requirements:
#   • wrangler  (already installed as a dev dep in backend/)
#   • jq        (brew install jq)
#   • You must be authenticated with Cloudflare:
#       npx wrangler login   OR   set CLOUDFLARE_API_TOKEN in your env
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DB_NAME="content-gen"
DB_ID="817de96b-2bb4-4b97-abbf-0250dada047d"

# Script lives at backend/schema/ → repo root is two levels up
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCHEMA_DIR="$SCRIPT_DIR"   # write SQL files alongside this script

# ── Helpers ───────────────────────────────────────────────────────────────────
run_wrangler() {
  # Run from backend/ so wrangler picks up wrangler.jsonc (DB binding is defined there)
  (cd "$SCRIPT_DIR/.." && npx wrangler d1 execute "$DB_NAME" \
    --remote \
    --json \
    --command="$1")
}

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "$SCHEMA_DIR"
echo "📂  Schema output → $SCHEMA_DIR"
echo ""

# ── Step 1: list all user-created objects (tables + indexes) ──────────────────
echo "🔍  Querying sqlite_master on production D1 …"
RAW_JSON=$(run_wrangler \
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name;")

# wrangler --json returns an array; grab the first element's "results"
OBJECTS=$(echo "$RAW_JSON" | jq -r '.[0].results // []')

TOTAL=$(echo "$OBJECTS" | jq 'length')
if [[ "$TOTAL" -eq 0 ]]; then
  echo "⚠️   No objects found. Make sure you are logged in with wrangler and the DB name/ID are correct."
  exit 1
fi

echo "✅  Found $TOTAL object(s) in sqlite_master"
echo ""

# ── Step 2: write one file per table (and one per index, grouped by table) ────
while IFS= read -r row; do
  TYPE=$(echo "$row" | jq -r '.type')
  NAME=$(echo "$row" | jq -r '.name')
  SQL=$(echo "$row"  | jq -r '.sql')

  case "$TYPE" in
    table)
      FILE="$SCHEMA_DIR/${NAME}.sql"
      {
        echo "-- ──────────────────────────────────────────────────"
        echo "-- Table: $NAME"
        echo "-- Exported: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
        echo "-- ──────────────────────────────────────────────────"
        echo ""
        echo "${SQL};"
        echo ""
      } > "$FILE"
      echo "  📄  $NAME.sql"
      ;;

    index)
      # Append the index to the file of the table it belongs to.
      # Derive the parent table name from the SQL: "... ON <table> ..."
      PARENT_TABLE=$(echo "$SQL" | grep -oiE 'ON[[:space:]]+"?[a-zA-Z_][a-zA-Z0-9_]+"?' \
                     | awk '{print $2}' | tr -d '"' | head -1)

      TARGET_FILE="$SCHEMA_DIR/${PARENT_TABLE}.sql"

      # Fall back to _indexes.sql if the parent table file doesn't exist yet
      if [[ ! -f "$TARGET_FILE" ]]; then
        TARGET_FILE="$SCHEMA_DIR/_indexes.sql"
      fi

      {
        echo "-- Index: $NAME"
        echo "${SQL};"
        echo ""
      } >> "$TARGET_FILE"
      echo "  🔑  index $NAME → $(basename "$TARGET_FILE")"
      ;;

    *)
      # triggers, views, etc. – write to a misc file
      MISC_FILE="$SCHEMA_DIR/_misc.sql"
      {
        echo "-- $TYPE: $NAME"
        echo "${SQL};"
        echo ""
      } >> "$MISC_FILE"
      echo "  📎  $TYPE $NAME → _misc.sql"
      ;;
  esac
done < <(echo "$OBJECTS" | jq -c '.[]')

echo ""
echo "🎉  Done! All schemas saved to $SCHEMA_DIR"
