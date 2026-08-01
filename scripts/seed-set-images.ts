#!/usr/bin/env node
/**
 * Seed vision embeddings + perceptual hashes for all cards in a specific set.
 *
 * Usage:
 *   node --import tsx scripts/seed-set-images.ts <setId> [options]
 *
 * Examples:
 *   node --import tsx scripts/seed-set-images.ts sv1
 *   node --import tsx scripts/seed-set-images.ts sv1 --force        # re-process even if already done
 *   node --import tsx scripts/seed-set-images.ts sv1 --dry-run      # preview only
 *   node --import tsx scripts/seed-set-images.ts sv1 --concurrency 4
 *
 * Or via npm:
 *   npm run seed:set -- sv1
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  computeVisionEmbeddingFromBuffer,
  toPgVectorLiteral,
} from "../apps/api/src/lib/visionEmbedding.ts";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(process.cwd(), "apps/api/.env") });
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const setId = args.find((a) => !a.startsWith("--"));
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const concurrency = Number.parseInt(
  args[args.indexOf("--concurrency") + 1] ?? "6",
  10,
);

if (!setId) {
  console.error(
    "Usage: node --import tsx scripts/seed-set-images.ts <setId> [--force] [--dry-run] [--concurrency N]",
  );
  process.exit(1);
}

if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 32) {
  console.error("--concurrency must be between 1 and 32.");
  process.exit(1);
}

const EMBEDDING_SOURCE = "vision-v1";
const EMBEDDING_VARIANT = "rgb64-hsvdctedge";

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Image URL helpers
// ---------------------------------------------------------------------------

const parseImageUrls = (
  cardData: unknown,
): { small: string | null; large: string | null } => {
  const root = typeof cardData === "object" && cardData ? cardData : null;
  const images =
    root && "images" in root && typeof root.images === "object" && root.images
      ? (root.images as Record<string, unknown>)
      : null;

  const toUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  };

  return { small: toUrl(images?.small), large: toUrl(images?.large) };
};

const pickUrl = (card: { data: unknown }): string | null => {
  const { small, large } = parseImageUrls(card.data);
  return small ?? large;
};

// ---------------------------------------------------------------------------
// Hash helpers (dhash64 + phash64 matching backfill-card-hashes.ts)
// ---------------------------------------------------------------------------

const loadGrayscale = async (
  buf: Buffer,
  width: number,
  height: number,
): Promise<Uint8Array> =>
  sharp(buf)
    .rotate()
    .grayscale()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

const dhash64 = (px: Uint8Array): string => {
  // 9×8 pixels → 64-bit hash
  let hash = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash += (px[y * 9 + x] ?? 0) > (px[y * 9 + x + 1] ?? 0) ? "1" : "0";
    }
  }
  return hash;
};

const dct2d = (matrix: number[][]): number[][] => {
  const n = matrix.length;
  const out: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const c = (i: number) => (i === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          sum +=
            (matrix[i]?.[j] ?? 0) *
            Math.cos(((2 * i + 1) * u * Math.PI) / (2 * n)) *
            Math.cos(((2 * j + 1) * v * Math.PI) / (2 * n));
      out[u]![v] = c(u) * c(v) * sum;
    }
  }
  return out;
};

const phash64 = (px: Uint8Array): string => {
  // 32×32 pixels → 64-bit hash
  const matrix: number[][] = [];
  for (let y = 0; y < 32; y++) {
    const row: number[] = [];
    for (let x = 0; x < 32; x++) row.push(px[y * 32 + x] ?? 0);
    matrix.push(row);
  }
  const dct = dct2d(matrix);
  const coeffs: number[] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      if (!(x === 0 && y === 0)) coeffs.push(dct[y]?.[x] ?? 0);
  const med =
    [...coeffs].sort((a, b) => a - b)[Math.floor(coeffs.length / 2)] ?? 0;
  let hash = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) {
        hash += "0";
        continue;
      }
      hash += (dct[y]?.[x] ?? 0) > med ? "1" : "0";
    }
  return hash;
};

// ---------------------------------------------------------------------------
// DB writes
// ---------------------------------------------------------------------------

const upsertEmbedding = async (
  cardId: string,
  embedding: number[],
): Promise<void> => {
  const vectorLiteral = toPgVectorLiteral(embedding);
  const id = randomUUID();
  await prisma.$executeRaw`
    DELETE FROM "CardEmbedding"
    WHERE "cardId" = ${cardId}
      AND source = ${EMBEDDING_SOURCE}
      AND COALESCE(variant, '') = ${EMBEDDING_VARIANT}
  `;
  await prisma.$executeRaw`
    INSERT INTO "CardEmbedding" (id, "cardId", source, variant, embedding, "createdAt")
    VALUES (${id}, ${cardId}, ${EMBEDDING_SOURCE}, ${EMBEDDING_VARIANT}, ${vectorLiteral}::vector, NOW())
  `;
};

const upsertHash = async (
  cardId: string,
  algorithm: string,
  hash: string,
): Promise<void> => {
  await prisma.cardHash.upsert({
    where: {
      cardId_algorithm_variant: { cardId, algorithm, variant: "small" },
    },
    create: { id: randomUUID(), cardId, algorithm, hash, variant: "small" },
    update: { hash },
  });
};

// ---------------------------------------------------------------------------
// Concurrency runner
// ---------------------------------------------------------------------------

const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const cur = idx++;
        if (cur >= items.length) return;
        await worker(items[cur]!);
      }
    }),
  );
};

// ---------------------------------------------------------------------------
// Per-card processing
// ---------------------------------------------------------------------------

type ProcessResult = { ok: true } | { ok: false; reason: string };

const processCard = async (card: {
  id: string;
  data: unknown;
}): Promise<ProcessResult> => {
  const url = pickUrl(card);
  if (!url) return { ok: false, reason: "no_image_url" };

  const response = await fetch(url);
  if (!response.ok) return { ok: false, reason: `http_${response.status}` };

  const buf = Buffer.from(await response.arrayBuffer());

  // Embedding
  const embedding = await computeVisionEmbeddingFromBuffer(buf);
  await upsertEmbedding(card.id, embedding);

  // Hashes
  const [dhPx, phPx] = await Promise.all([
    loadGrayscale(buf, 9, 8),
    loadGrayscale(buf, 32, 32),
  ]);
  await Promise.all([
    upsertHash(card.id, "dhash64", dhash64(dhPx)),
    upsertHash(card.id, "phash64", phash64(phPx)),
  ]);

  return { ok: true };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log(`\nLooking up cards for set: ${setId}`);

  const allCards = await prisma.card.findMany({
    where: { id: { startsWith: `${setId}-` } },
    select: { id: true, data: true },
    orderBy: { id: "asc" },
  });

  if (allCards.length === 0) {
    console.error(
      `No cards found for set "${setId}". Check the set ID and make sure cards are imported.`,
    );
    process.exit(1);
  }

  console.log(`Found ${allCards.length} cards in set "${setId}".`);

  let cards = allCards;

  if (!force) {
    // Skip cards that already have an embedding for this source+variant
    const existing = await prisma.cardEmbedding.findMany({
      where: {
        cardId: { in: allCards.map((c) => c.id) },
        source: EMBEDDING_SOURCE,
        variant: EMBEDDING_VARIANT,
      },
      select: { cardId: true },
    });
    const doneIds = new Set(existing.map((e) => e.cardId));
    cards = allCards.filter((c) => !doneIds.has(c.id));

    if (cards.length === 0) {
      console.log(
        `All ${allCards.length} cards already have embeddings. Use --force to re-process.`,
      );
      return;
    }

    console.log(
      `Skipping ${doneIds.size} already-processed cards. Processing ${cards.length} remaining.`,
    );
  }

  if (dryRun) {
    console.log(`[dry-run] Would process ${cards.length} cards. Exiting.`);
    return;
  }

  console.log(`Processing with concurrency=${concurrency}...\n`);

  let done = 0;
  let ok = 0;
  const failures: Record<string, number> = {};

  await runWithConcurrency(cards, concurrency, async (card) => {
    try {
      const result = await processCard(card);
      if (result.ok) {
        ok += 1;
      } else {
        failures[result.reason] = (failures[result.reason] ?? 0) + 1;
      }
    } catch (err) {
      const reason =
        err instanceof Error ? err.message.slice(0, 60) : "unknown";
      failures[reason] = (failures[reason] ?? 0) + 1;
    }
    done += 1;
    if (done % 10 === 0 || done === cards.length) {
      process.stdout.write(`  ${done}/${cards.length} (${ok} ok)\r`);
    }
  });

  console.log(`\n\nDone! ${ok}/${cards.length} cards processed successfully.`);
  if (Object.keys(failures).length > 0) {
    console.log("Failures:");
    for (const [reason, count] of Object.entries(failures)) {
      console.log(`  ${reason}: ${count}`);
    }
  }
};

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
