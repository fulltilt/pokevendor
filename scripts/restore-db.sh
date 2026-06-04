#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-pokevendor}"
DB_NAME="${DB_NAME:-pokevendor}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not in PATH" >&2
  exit 1
fi

if ! docker compose ps "$DB_SERVICE" >/dev/null 2>&1; then
  echo "Error: docker compose service '$DB_SERVICE' not found." >&2
  echo "Run from repo root or set DB_SERVICE to the correct service name." >&2
  exit 1
fi

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [backup-file.sql.gz]" >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  DUMP_FILE="$1"
else
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "Error: backup directory not found: $BACKUP_DIR" >&2
    exit 1
  fi

  latest_file="$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -n 1 || true)"
  if [[ -z "$latest_file" ]]; then
    echo "Error: no .sql.gz backups found in $BACKUP_DIR" >&2
    exit 1
  fi
  DUMP_FILE="$latest_file"
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Error: backup file does not exist: $DUMP_FILE" >&2
  exit 1
fi

echo "Restoring from: $DUMP_FILE"

echo "Dropping database '$DB_NAME' (if exists)..."
docker compose exec -T "$DB_SERVICE" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"

echo "Creating database '$DB_NAME'..."
docker compose exec -T "$DB_SERVICE" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";"

echo "Importing SQL dump..."
gunzip -c "$DUMP_FILE" | docker compose exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME"

echo "Restore complete."