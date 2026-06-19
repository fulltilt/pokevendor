#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  computeVisionEmbeddingFromBuffer,
  toPgVectorLiteral,
} from "../apps/api/src/lib/visionEmbedding.ts";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(process.cwd(), "apps/api/.env") });
}

type CliOptions = {
  source: string;
  variant: string;
  prefer: "small" | "large";
  limit: number;
  offset: number;
  concurrency: number;
  dryRun: boolean;
  all: boolean;
  cardId: string | null;
  setId: string | null;
};

type CardRow = {
  id: string;
  data: unknown;
};

const prisma = new PrismaClient();

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);

  const valueFor = (name: string): string | null => {
    const idx = args.indexOf(name);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  const source = valueFor("--source") ?? "vision-v1";
  const variant = valueFor("--variant") ?? "rgb64-hsvdctedge";
  const prefer = (valueFor("--prefer") ?? "small").toLowerCase();
  const limit = Number.parseInt(valueFor("--limit") ?? "500", 10);
  const offset = Number.parseInt(valueFor("--offset") ?? "0", 10);
  const concurrency = Number.parseInt(valueFor("--concurrency") ?? "8", 10);
  const cardId = valueFor("--card-id");
  const setId = valueFor("--set-id");
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

  const typedPrefer: "small" | "large" = prefer;

  return {
    source,
    variant,
    prefer: typedPrefer,
    limit,
    offset,
    concurrency,
    dryRun,
    all,
    cardId,
    setId,
  };
};

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
    if (!trimmed) return null;
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  };

  return {
    small: toUrl(images?.small),
    large: toUrl(images?.large),
  };
};

const fetchCards = async (options: CliOptions): Promise<CardRow[]> => {
  if (options.cardId) {
    const card = await prisma.card.findUnique({
      where: { id: options.cardId },
      select: { id: true, data: true },
    });
    return card ? [card] : [];
  }

  const where = options.setId
    ? { id: { startsWith: `${options.setId}-` } }
    : {};

  if (options.all || options.setId) {
    return prisma.card.findMany({ where, select: { id: true, data: true } });
  }

  return prisma.card.findMany({
    where,
    select: { id: true, data: true },
    skip: options.offset,
    take: options.limit,
    orderBy: { id: "asc" },
  });
};

const toCardImageUrl = (
  card: CardRow,
  prefer: "small" | "large",
): string | null => {
  const urls = parseImageUrls(card.data);
  if (prefer === "large") return urls.large ?? urls.small;
  return urls.small ?? urls.large;
};

const upsertEmbedding = async (
  cardId: string,
  source: string,
  variant: string,
  embedding: number[],
): Promise<void> => {
  const vectorLiteral = toPgVectorLiteral(embedding);
  const id = randomUUID();

  await prisma.$executeRaw`
    DELETE FROM "CardEmbedding"
    WHERE "cardId" = ${cardId}
      AND source = ${source}
      AND COALESCE(variant, '') = ${variant}
  `;

  await prisma.$executeRaw`
    INSERT INTO "CardEmbedding" (id, "cardId", source, variant, embedding, "createdAt")
    VALUES (${id}, ${cardId}, ${source}, ${variant}, ${vectorLiteral}::vector, NOW())
  `;
};

const processOne = async (
  card: CardRow,
  options: CliOptions,
): Promise<{ ok: boolean; reason?: string }> => {
  const imageUrl = toCardImageUrl(card, options.prefer);
  if (!imageUrl) return { ok: false, reason: "no_image" };

  const response = await fetch(imageUrl);
  if (!response.ok) {
    return { ok: false, reason: `http_${response.status}` };
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const embedding = await computeVisionEmbeddingFromBuffer(imageBuffer);

  if (!options.dryRun) {
    await upsertEmbedding(card.id, options.source, options.variant, embedding);
  }

  return { ok: true };
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= items.length) return;
        const item = items[current];
        if (item === undefined) return;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
};

const main = async () => {
  const options = parseArgs();
  const cards = await fetchCards(options);

  if (cards.length === 0) {
    console.log("No cards selected. Nothing to do.");
    return;
  }

  console.log(
    `Embedding ${cards.length} cards (source=${options.source}, variant=${options.variant}, dryRun=${options.dryRun})...`,
  );

  let ok = 0;
  const failures: Record<string, number> = {};

  await runWithConcurrency(cards, options.concurrency, async (card) => {
    try {
      const result = await processOne(card, options);
      if (result.ok) {
        ok += 1;
      } else {
        failures[result.reason ?? "unknown"] =
          (failures[result.reason ?? "unknown"] ?? 0) + 1;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      failures[reason] = (failures[reason] ?? 0) + 1;
    }
  });

  console.log(`Done. success=${ok}, failed=${cards.length - ok}`);
  if (Object.keys(failures).length > 0) {
    console.log("Failure summary:");
    for (const [reason, count] of Object.entries(failures)) {
      console.log(`  ${reason}: ${count}`);
    }
  }
};

main()
  .catch((error) => {
    console.error("Embedding backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
