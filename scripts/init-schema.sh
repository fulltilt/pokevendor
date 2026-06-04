#!/bin/sh
set -e

# Wait for database to be ready
echo "Waiting for database..."
until psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; do
  echo "Database not ready, waiting..."
  sleep 1
done
echo "Database is ready!"

# Create the Card table
echo "Creating Card table schema..."
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" << 'EOF'
CREATE TABLE IF NOT EXISTS "Card" (
    id TEXT PRIMARY KEY,
    data JSONB,
    "tcgPlayerId" TEXT,
    embedding vector,
    "createdAt" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "Card_tcgPlayerId_idx" ON "Card"("tcgPlayerId");

CREATE TABLE IF NOT EXISTS "CardEmbedding" (
    id TEXT PRIMARY KEY,
    "cardId" TEXT NOT NULL REFERENCES "Card"(id) ON DELETE CASCADE,
    source TEXT DEFAULT 'clip',
    variant TEXT,
    embedding vector,
    "createdAt" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "CardEmbedding_cardId_idx" ON "CardEmbedding"("cardId");
CREATE INDEX IF NOT EXISTS "CardEmbedding_source_idx" ON "CardEmbedding"(source);

CREATE TABLE IF NOT EXISTS "CardHash" (
    id TEXT PRIMARY KEY,
    "cardId" TEXT NOT NULL REFERENCES "Card"(id) ON DELETE CASCADE,
    algorithm TEXT DEFAULT 'phash',
    hash TEXT,
    variant TEXT,
    "createdAt" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "CardHash_cardId_algorithm_idx" ON "CardHash"("cardId", algorithm);
CREATE INDEX IF NOT EXISTS "CardHash_algorithm_hash_idx" ON "CardHash"(algorithm, hash);

CREATE TABLE IF NOT EXISTS "PriceEntry" (
    id TEXT PRIMARY KEY,
    "cardId" TEXT NOT NULL REFERENCES "Card"(id) ON DELETE CASCADE,
    date TIMESTAMP,
    price FLOAT,
    "createdAt" TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PriceEntry_cardId_date_idx" ON "PriceEntry"("cardId", date);
EOF

echo "Schema created successfully!"
