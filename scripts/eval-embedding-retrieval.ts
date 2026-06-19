#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  computeVisionEmbeddingFromBuffer,
  toPgVectorLiteral,
} from "../apps/api/src/lib/visionEmbedding.ts";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(process.cwd(), "apps/api/.env") });
}

type EvalSample = {
  cardId: string;
  imageUrl?: string;
  imagePath?: string;
};

type CliOptions = {
  file: string;
  source: string;
  topK: number;
};

const prisma = new PrismaClient();

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const valueFor = (name: string): string | null => {
    const idx = args.indexOf(name);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  const file = valueFor("--file");
  const source = valueFor("--source") ?? "vision-v1";
  const topK = Number.parseInt(valueFor("--topk") ?? "5", 10);

  if (!file) {
    throw new Error("Missing required --file path to JSON eval samples.");
  }
  if (!Number.isFinite(topK) || topK < 1 || topK > 100) {
    throw new Error("--topk must be between 1 and 100.");
  }

  return { file, source, topK };
};

const loadSamples = async (file: string): Promise<EvalSample[]> => {
  const abs = resolve(process.cwd(), file);
  const text = await readFile(abs, "utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new TypeError("Eval file must be a JSON array.");
  }

  const samples = parsed
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const cardId = typeof item.cardId === "string" ? item.cardId.trim() : "";
      const imageUrl =
        typeof item.imageUrl === "string" ? item.imageUrl.trim() : undefined;
      const imagePath =
        typeof item.imagePath === "string" ? item.imagePath.trim() : undefined;
      if (!cardId || (!imageUrl && !imagePath)) return null;
      return { cardId, imageUrl, imagePath };
    })
    .filter((sample): sample is EvalSample => !!sample);

  if (samples.length === 0) {
    throw new Error("No valid eval samples found.");
  }

  return samples;
};

const loadImageBuffer = async (sample: EvalSample): Promise<Buffer> => {
  if (sample.imageUrl) {
    const response = await fetch(sample.imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const abs = resolve(process.cwd(), sample.imagePath ?? "");
  return readFile(abs);
};

const searchTop = async (
  embedding: number[],
  source: string,
  topK: number,
): Promise<string[]> => {
  const vectorLiteral = toPgVectorLiteral(embedding);

  const rows = await prisma.$queryRaw<Array<{ cardId: string }>>`
    SELECT ce."cardId" AS "cardId"
    FROM "CardEmbedding" ce
    WHERE ce.source = ${source}
    ORDER BY ce.embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `;

  return rows.map((row) => row.cardId).filter((cardId) => !!cardId);
};

const main = async () => {
  const options = parseArgs();
  const samples = await loadSamples(options.file);

  let top1Hits = 0;
  let top5Hits = 0;
  let processed = 0;
  const failures: Array<{ cardId: string; reason: string }> = [];

  for (const sample of samples) {
    try {
      const imageBuffer = await loadImageBuffer(sample);
      const embedding = await computeVisionEmbeddingFromBuffer(imageBuffer);
      const top = await searchTop(
        embedding,
        options.source,
        Math.max(5, options.topK),
      );
      processed += 1;

      if (top[0] === sample.cardId) {
        top1Hits += 1;
      }
      if (top.slice(0, 5).includes(sample.cardId)) {
        top5Hits += 1;
      }
    } catch (error) {
      failures.push({
        cardId: sample.cardId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const top1 = processed > 0 ? (top1Hits / processed) * 100 : 0;
  const top5 = processed > 0 ? (top5Hits / processed) * 100 : 0;

  console.log(`Processed: ${processed}/${samples.length}`);
  console.log(`Top-1: ${top1.toFixed(2)}% (${top1Hits}/${processed})`);
  console.log(`Top-5: ${top5.toFixed(2)}% (${top5Hits}/${processed})`);

  if (failures.length > 0) {
    console.log("Failures:");
    for (const failure of failures.slice(0, 20)) {
      console.log(`  ${failure.cardId}: ${failure.reason}`);
    }
  }
};

main()
  .catch((error) => {
    console.error("Eval failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
