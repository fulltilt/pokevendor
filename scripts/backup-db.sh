#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-pokevendor}"
DB_NAME="${DB_NAME:-pokevendor}"

mkdir -p "$BACKUP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not in PATH" >&2
  exit 1
fi

if ! docker compose ps "$DB_SERVICE" >/dev/null 2>&1; then
  echo "Error: docker compose service '$DB_SERVICE' not found." >&2
  echo "Run from repo root or set DB_SERVICE to the correct service name." >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/${DB_NAME}-${TIMESTAMP}.sql.gz"

echo "Creating database backup: $OUT_FILE"
docker compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$OUT_FILE"

echo "Backup complete: $OUT_FILE"