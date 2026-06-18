# Stage 1 Card Recognition Playbook (URL Image Hashing)

This playbook documents the fast MVP flow:

1. Import card data with normalized image URLs
2. Generate perceptual hashes for database cards from those URLs
3. Run recognition to retrieve nearest candidates
4. Leave re-ranking as a later step

## What Stage 1 currently includes

Implemented now:

- pHash (64-bit)
- dHash (64-bit)
- Nearest-neighbor shortlist using Hamming distance on pHash + dHash

Not implemented yet:

- wHash
- Feature-matching re-rank

## Prerequisites on another laptop

- Docker and Docker Compose installed
- Node.js 22+ installed
- Repo cloned

Install dependencies from repo root:

    npm install

## Environment setup

The hash import/backfill scripts read DATABASE_URL from apps/api/.env when not already set.

Create apps/api/.env if missing:

    DATABASE_URL="postgresql://pokevendor:pokevendor@localhost:5432/pokevendor"
    PORT=3001
    NODE_ENV=development

## Start services

Recommended:

    docker compose up -d db

If you want to test recognition endpoint right away:

    docker compose up -d api

Or run full stack:

    docker compose up

## Step 1: Import cards and normalize image URLs

Script:

- scripts/import-tcgdex-cards.ts

Example (explicit set counts):

    npx ts-node scripts/import-tcgdex-cards.ts me03:124 me04:122

Example (known default counts from script):

    npx ts-node scripts/import-tcgdex-cards.ts me03 me04

Expected outcome:

- Cards are inserted or updated in Card table
- data.images.small and data.images.large are normalized for hashing input

## Step 2: Backfill hashes from image URLs (dry run first)

Command (dry-run, single set):

    npm run hash:cards -- --set-id me03 --prefer small --dry-run

Command (dry-run, batch without set filter):

    npm run hash:cards -- --dry-run --limit 200 --offset 0 --prefer small --concurrency 8

What this does:

- Reads card.data.images.small or card.data.images.large
- Downloads image
- Converts to grayscale and computes:
  - dHash 64-bit
  - pHash 64-bit
- In dry-run mode, does not write to DB

## Step 3: Write hashes to database

Command (single set — recommended for first run):

    npm run hash:cards -- --set-id me03 --prefer small --concurrency 8
    npm run hash:cards -- --set-id me04 --prefer small --concurrency 8

Command (all cards):

    npm run hash:cards -- --all --prefer small --concurrency 8

Optional single-card test:

    npm run hash:cards -- --card-id me03-001 --prefer small --dry-run
    npm run hash:cards -- --card-id me03-001 --prefer small

Flags summary:

| Flag                  | Description                                         |
| --------------------- | --------------------------------------------------- |
| --set-id me03         | Only hash cards whose id starts with me03-          |
| --all                 | Hash every card in the database                     |
| --card-id me03-001    | Hash a single card                                  |
| --limit / --offset    | Batch mode when no set-id, all, or card-id is given |
| --prefer small\|large | Which image size to download (default: small)       |
| --concurrency N       | Parallel download workers, 1–64 (default: 8)        |
| --dry-run             | Compute hashes but do not write to DB               |

Expected database writes:

- CardHash rows with
  - algorithm=phash, variant=v1-64
  - algorithm=dhash, variant=v1-64

Note:

- Backfill upserts by deleting old v1-64 phash/dhash rows per card then recreating them.
- When --set-id is given, --limit and --offset are ignored (all matching cards are processed).

## Step 4: Test recognition shortlist

Endpoint:

- POST /api/cards/recognize

If API runs on port 3001, test with URL input:

    curl -X POST http://localhost:3001/api/cards/recognize \
      -H "Content-Type: application/json" \
      -d '{
        "imageUrl": "https://your-image-url-here.jpg",
        "topK": 20,
        "setId": "me03"
      }'

Expected response includes:

- query.hashes.phash
- query.hashes.dhash
- matches[] with distances.phash, distances.dhash, distances.total

Interpretation:

- Lower total distance means a closer visual hash match.

## Operational notes for repeated runs

- Import script is safe to rerun; it updates changed cards.
- Hash backfill is safe to rerun; it refreshes v1-64 hashes.
- If you import new sets, rerun hash backfill to include new cards.

## Troubleshooting

No images found for many cards:

- Re-run import for those sets to normalize images.small/images.large.

Hash backfill failures downloading images:

- Confirm outbound network access from your laptop/container.
- Retry with lower concurrency, for example --concurrency 4.

Recognition returns weak matches:

- Ensure hashes were generated for the target set.
- Use setId filter in recognize request.
- Increase topK to inspect a larger shortlist.

## Next step after Stage 1

When ready for higher accuracy:

- Add wHash generation/storage
- Add simple feature matching re-rank over Stage 1 top candidates
