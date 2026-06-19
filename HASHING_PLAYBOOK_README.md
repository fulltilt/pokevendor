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

## Stage 2 Accuracy Plan (Embeddings + ANN)

This section is the robust path when you want better results without relying on setId filters.

### 1) Use embedding retrieval as the primary matcher

Step:

- Move primary retrieval from pure hash distance to image embeddings + cosine similarity.

Purpose:

- Embeddings are more robust to sleeve glare, camera angle, and background variation than pHash/dHash.

### 2) Build card embeddings for catalog images

Step:

- Compute one normalized embedding vector per card image and store it in CardEmbedding.

Purpose:

- Converts card recognition into a nearest-neighbor vector search problem that scales better than pairwise hash comparisons.

### 3) Create an ANN index (HNSW)

Step:

- Build an HNSW index on CardEmbedding.embedding with cosine ops.

Purpose:

- Keeps lookup fast at larger catalog sizes while preserving high recall in top candidates.

### 4) Keep hash path as fallback

Step:

- If no embedding candidates are returned, run the existing hash path for fallback.

Purpose:

- Preserves availability and gives a degraded-but-usable response if embedding data is incomplete.

### 5) Add targeted data augmentation

Step:

- Use realistic training/eval perturbations that mimic phone captures.

Purpose:

- Improves generalization to real world conditions and reduces overfitting to clean catalog art.

Recommended augmentations and why:

- Glare overlays/specular streaks: teaches robustness to sleeve shine and direct light reflections.
- Exposure and white-balance shifts: makes matching stable across warm/cool indoor lighting.
- Perspective warp, rotation, and crop: handles tilted photos and imperfect framing.
- Motion blur and JPEG compression noise: simulates quick captures and messaging-app artifacts.
- Partial occlusion (fingers/sleeve edges): avoids hard failure when corners or borders are blocked.

### 6) Start with a small controlled subset

Step:

- Begin with 200-1000 cards across a few sets.

Purpose:

- Lets you iterate quickly on retrieval quality and preprocessing before full-catalog compute cost.

### 7) Measure retrieval quality before full rollout

Step:

- Track top-1 and top-5 on a labeled validation set and compare each pipeline change.

Purpose:

- Prevents subjective tuning and ensures every change is improving real retrieval metrics.

### 8) Optional re-rank after ANN shortlist

Step:

- Re-rank ANN top candidates (for example top-20) with a stronger secondary comparator.

Purpose:

- Improves top-1 precision where many cards are visually close while keeping latency manageable.

## Stage 2 Implementation Checklist in this repo

Current commands:

- Backfill embeddings:

      npm run embed:cards -- --set-id me1 --source vision-v1 --variant rgb64-hsvdctedge --concurrency 8

- Build ANN index:

      npm run embed:index -- --source vision-v1

- Evaluate top-1/top-5 from labeled samples file:

      npm run embed:eval -- --file path/to/eval-samples.json --source vision-v1 --topk 5

Expected eval sample format:

    [
      {
     "cardId": "me1-001",
     "imagePath": "./tmp/eval/me1-001-1.jpg"
      },
      {
     "cardId": "me1-025",
     "imageUrl": "https://example.com/pikachu-photo.jpg"
      }
    ]

## Smoke Test Instructions (another laptop)

Run these in order.

### A) Bring up dependencies

1. Start Postgres/pgvector:

   docker compose up -d db

2. Start API:

   npm run dev -w apps/api

3. Optional health check:

   curl -sS http://localhost:3001/health | cat

### B) Ensure embedding data exists

1. Backfill at least one set:

   npm run embed:cards -- --set-id me1 --source vision-v1 --variant rgb64-hsvdctedge --concurrency 8

2. Build ANN index:

   npm run embed:index -- --source vision-v1

### C) Run endpoint smoke test

Use multipart upload (recommended because it avoids URL/DNS dependency):

    curl -sS -X POST http://localhost:3001/api/cards/recognize-embedding \
      -F image=@/absolute/path/to/card-photo.jpg \
      -F topK=20 \
      -F embeddingSource=vision-v1 | cat

Expected response shape:

- mode should be embedding-ann (or hash-fallback if embeddings are missing)
- matches[] should include cardId, name, number, image, and similarity for embedding mode

Interpretation:

- Higher similarity is better in embedding mode.
- For confidence checks, compare top-1 similarity against top-2 similarity gap.

Quick jq helper (top-1/top-2/gap):

    curl -sS -X POST http://localhost:3001/api/cards/recognize-embedding \
      -F image=@/absolute/path/to/card-photo.jpg \
      -F topK=20 \
      -F embeddingSource=vision-v1 \
      | jq '{
          mode,
          top1: .matches[0] | { cardId, name, similarity },
          top2: .matches[1] | { cardId, name, similarity },
          similarityGap: ((.matches[0].similarity // 0) - (.matches[1].similarity // 0))
        }'

If jq is not installed:

    brew install jq

### D) Optional hash baseline comparison

    curl -sS -X POST http://localhost:3001/api/cards/recognize \
      -F image=@/absolute/path/to/card-photo.jpg \
      -F topK=20 | cat

Use this to compare whether embedding retrieval improves top-1/top-5 for your capture conditions.

## Smoke Test Scoring Rubric (quick pass/fail)

Use this lightweight rubric when reviewing recognize-embedding output during smoke tests.

### Metrics to inspect per request

- Top-1 correctness: is matches[0].cardId the true card?
- Top-5 coverage: is the true card anywhere in matches[0..4]?
- Similarity gap: top1.similarity - top2.similarity

### Suggested interpretation bands

- Strong hit:
  - Top-1 is correct, and
  - Similarity gap >= 0.030
  - Action: auto-suggest top-1 confidently.

- Acceptable hit:
  - Top-1 is correct, and
  - Similarity gap is between 0.010 and 0.029
  - Action: show top-3 with top-1 preselected.

- Ambiguous hit:
  - Top-1 may be wrong or unstable, or
  - Similarity gap < 0.010
  - Action: require user confirmation from top-5; do not auto-add.

### Session-level acceptance target

For a small smoke batch of 20-50 photos:

- Top-1 >= 70% is a good early signal.
- Top-5 >= 90% indicates retrieval is generally healthy.
- If Top-5 is low, prioritize preprocessing and augmentation fixes first.

### If results are weak, tune in this order

1. Verify embeddings exist for the tested cards (embed:cards completed for relevant sets).
2. Ensure ANN index was built after embedding backfill (embed:index).
3. Increase topK (for example 20 -> 50) and inspect where true card appears.
4. Improve input normalization (crop/deskew card before embedding).
5. Increase augmentation realism for glare, perspective, blur, and occlusion.
