#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import sharp from "sharp";
import { resolve } from "path";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(process.cwd(), "apps/api/.env") });
}

type CliOptions = {
  prefer: "small" | "large";
  limit: number;
  offset: number;
  concurrency: number;
  dryRun: boolean;
  all: boolean;
  cardId: string | null;
};

type CardRow = {
  id: string;
  data: unknown;
};

type ParsedImageUrls = {
  small: string | null;
  large: string | null;
};

const prisma = new PrismaClient();

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);

  const valueFor = (name: string): string | null => {
    const idx = args.indexOf(name);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  const prefer = (valueFor("--prefer") ?? "small").toLowerCase();
  const limit = Number.parseInt(valueFor("--limit") ?? "500", 10);
  const offset = Number.parseInt(valueFor("--offset") ?? "0", 10);
  const concurrency = Number.parseInt(valueFor("--concurrency") ?? "8", 10);
  const cardId = valueFor("--card-id");
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");

  if (prefer !== "small" && prefer !== "large") {
    throw new Error("--prefer must be either 'small' or 'large'.");
  }
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  if (!Number.isFinite(offset) || offset < 0) {
    throw new Error("--offset must be 0 or a positive integer.");
  }
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error("--concurrency must be between 1 and 64.");
  }

  return {
    prefer: prefer as "small" | "large",
    limit,
    offset,
    concurrency,
    dryRun,
    all,
    cardId,
  };
};

const parseImageUrls = (cardData: unknown): ParsedImageUrls => {
  const root = typeof cardData === "object" && cardData ? cardData : null;
  const images =
    root && "images" in root && typeof root.images === "object" && root.images
      ? (root.images as Record<string, unknown>)
      : null;

  const toUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;
    return trimmed;
  };

  return {
    small: toUrl(images?.small),
    large: toUrl(images?.large),
  };
};

const loadGrayscalePixels = async (
  imageUrl: string,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image (HTTP ${response.status})`);
  }

  const arrBuf = await response.arrayBuffer();
  const input = Buffer.from(arrBuf);
  const output = await sharp(input)
    .rotate()
    .grayscale()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  return output;
};

const dhash64 = (pixels: Uint8Array, width: number, height: number): string => {
  if (width !== 9 || height !== 8) {
    throw new Error("dhash64 expects 9x8 grayscale pixels.");
  }

  let hash = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * width + x] ?? 0;
      const right = pixels[y * width + x + 1] ?? 0;
      hash += left > right ? "1" : "0";
    }
  }
  return hash;
};

const dct2d = (matrix: number[][]): number[][] => {
  const n = matrix.length;
  const result: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  const c = (index: number) =>
    index === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);

  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          sum +=
            (matrix[i]?.[j] ?? 0) *
            Math.cos(((2 * i + 1) * u * Math.PI) / (2 * n)) *
            Math.cos(((2 * j + 1) * v * Math.PI) / (2 * n));
        }
      }
      result[u][v] = c(u) * c(v) * sum;
    }
  }

  return result;
};

const phash64 = (pixels: Uint8Array, width: number, height: number): string => {
  if (width !== 32 || height !== 32) {
    throw new Error("phash64 expects 32x32 grayscale pixels.");
  }

  const matrix: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      row.push(pixels[y * width + x] ?? 0);
    }
    matrix.push(row);
  }

  const dct = dct2d(matrix);
  const coeffs: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue;
      coeffs.push(dct[y]?.[x] ?? 0);
    }
  }

  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

  let hash = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) {
        hash += "0";
        continue;
      }
      const value = dct[y]?.[x] ?? 0;
      hash += value > median ? "1" : "0";
    }
  }

  return hash;
};

const chooseImageUrl = (
  images: ParsedImageUrls,
  prefer: "small" | "large",
): string | null => {
  if (prefer === "large") {
    return images.large ?? images.small;
  }
  return images.small ?? images.large;
};

const upsertHashes = async (
  cardId: string,
  phash: string,
  dhash: string,
  dryRun: boolean,
) => {
  if (dryRun) return;

  await prisma.$transaction([
    prisma.cardHash.deleteMany({
      where: { cardId, algorithm: "phash", variant: "v1-64" },
    }),
    prisma.cardHash.deleteMany({
      where: { cardId, algorithm: "dhash", variant: "v1-64" },
    }),
    prisma.cardHash.create({
      data: {
        cardId,
        algorithm: "phash",
        variant: "v1-64",
        hash: phash,
      },
    }),
    prisma.cardHash.create({
      data: {
        cardId,
        algorithm: "dhash",
        variant: "v1-64",
        hash: dhash,
      },
    }),
  ]);
};

const runWorkerPool = async <T>(
  items: T[],
  workerCount: number,
  worker: (item: T, index: number) => Promise<void>,
) => {
  let nextIndex = 0;

  const runOne = async () => {
    while (true) {
      const idx = nextIndex;
      if (idx >= items.length) return;
      nextIndex += 1;
      await worker(items[idx] as T, idx);
    }
  };

  const runners = Array.from({ length: workerCount }, () => runOne());
  await Promise.all(runners);
};

const main = async () => {
  const opts = parseArgs();

  console.log("Card hash backfill");
  console.log(`Prefer image size: ${opts.prefer}`);
  console.log(`Limit/offset: ${opts.limit}/${opts.offset}`);
  console.log(`Concurrency: ${opts.concurrency}`);
  console.log(`Mode: ${opts.dryRun ? "dry-run" : "write"}`);
  if (opts.all) {
    console.log("Batch selection: all cards");
  }
  if (opts.cardId) {
    console.log(`Single card mode: ${opts.cardId}`);
  }

  const cards = (await prisma.card.findMany({
    where: opts.cardId ? { id: opts.cardId } : undefined,
    select: { id: true, data: true },
    orderBy: { id: "asc" },
    take: opts.cardId || opts.all ? undefined : opts.limit,
    skip: opts.cardId ? undefined : opts.offset,
  })) as CardRow[];

  if (cards.length === 0) {
    console.log("No cards found for this batch.");
    return;
  }

  let success = 0;
  let missingImage = 0;
  let failed = 0;

  await runWorkerPool(cards, opts.concurrency, async (card, idx) => {
    const prefix = `[${idx + 1}/${cards.length}] ${card.id}`;
    try {
      const images = parseImageUrls(card.data);
      const url = chooseImageUrl(images, opts.prefer);
      if (!url) {
        missingImage++;
        console.log(`${prefix} -> skipped (no images.small/images.large)`);
        return;
      }

      const dhPixels = await loadGrayscalePixels(url, 9, 8);
      const phPixels = await loadGrayscalePixels(url, 32, 32);
      const dh = dhash64(dhPixels, 9, 8);
      const ph = phash64(phPixels, 32, 32);

      await upsertHashes(card.id, ph, dh, opts.dryRun);
      success++;
      console.log(`${prefix} -> ok`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${prefix} -> failed (${message})`);
    }
  });

  console.log("\nBackfill finished.");
  console.log(`Success: ${success}`);
  console.log(`Missing image: ${missingImage}`);
  console.log(`Failed: ${failed}`);
};

main()
  .catch((error) => {
    console.error(
      "Fatal:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
