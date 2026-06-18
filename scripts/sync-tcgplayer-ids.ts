#!/usr/bin/env node

/**
 * Sync tcgPlayerId values for cards in a set from a manually extracted ID array.
 *
 * Usage:
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --set-id <setId> --ids "[1,2,3]"
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --set-id <setId> --ids-file ./ids.json
 *
 * Examples:
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --set-id me02 --ids "[123,456,789]"
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --set-id me02 --ids-file ./me02-ids.json --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "path";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(import.meta.dirname, "../apps/api/.env") });
}

type Candidate = {
  productId: string;
};

type CardRow = {
  id: string;
  tcgPlayerId: string | null;
};

const prisma = new PrismaClient();

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const cardSortNumber = (cardId: string): number => {
  const suffix = cardId.split("-").pop() ?? "";
  const digits = suffix.replace(/\D/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

const loadCandidatesFromIds = (raw: unknown): Candidate[] => {
  if (!Array.isArray(raw)) {
    throw new Error("IDs input must be a JSON array.");
  }

  const candidates: Candidate[] = [];
  for (let i = 0; i < raw.length; i++) {
    const id = toStringOrNull(raw[i]);
    if (!id || !/^\d+$/.test(id)) {
      throw new Error(`Invalid TCGPlayer ID at index ${i}: ${String(raw[i])}`);
    }
    candidates.push({ productId: id });
  }

  return candidates;
};

const parseArgs = (): {
  setId: string;
  idsJson: string | null;
  idsFile: string | null;
  dryRun: boolean;
} => {
  const args = process.argv.slice(2);

  const getValue = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  const setId = getValue("--set-id") ?? getValue("-s");
  const idsJson = getValue("--ids") ?? getValue("-i");
  const idsFile = getValue("--ids-file") ?? getValue("-f");
  const dryRun = args.includes("--dry-run");

  if (!setId || (!idsJson && !idsFile) || (idsJson && idsFile)) {
    console.error(
      "Usage: node --import tsx scripts/sync-tcgplayer-ids.ts --set-id <setId> (--ids <jsonArray> | --ids-file <path>) [--dry-run]",
    );
    process.exit(1);
  }

  return { setId, idsJson, idsFile, dryRun };
};

const main = async () => {
  const { setId, idsJson, idsFile, dryRun } = parseArgs();

  console.log("Syncing TCGPlayer IDs from manual array");
  console.log(`Set ID: ${setId}`);
  if (idsFile) {
    console.log(`IDs Source: file (${idsFile})`);
  } else {
    console.log("IDs Source: inline JSON");
  }
  console.log(`Mode: ${dryRun ? "dry-run" : "write"}`);

  let parsedIdsInput: unknown;
  if (idsFile) {
    parsedIdsInput = JSON.parse(
      readFileSync(resolve(process.cwd(), idsFile), "utf8"),
    );
  } else {
    parsedIdsInput = JSON.parse(idsJson ?? "[]");
  }
  const candidates = loadCandidatesFromIds(parsedIdsInput);
  console.log(`Loaded ${candidates.length} manual IDs`);

  const setPrefix = `${setId}-`;
  const cards = (await prisma.card.findMany({
    where: {
      id: {
        startsWith: setPrefix,
      },
    },
    select: {
      id: true,
      tcgPlayerId: true,
    },
    orderBy: {
      id: "asc",
    },
  })) as CardRow[];

  if (cards.length === 0) {
    throw new Error(`No cards found in DB for set prefix ${setPrefix}`);
  }

  const sortedCards = [...cards].sort((a, b) => {
    const diff = cardSortNumber(a.id) - cardSortNumber(b.id);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  if (sortedCards.length !== candidates.length) {
    throw new Error(
      `ID count mismatch for set ${setId}: expected ${sortedCards.length} but received ${candidates.length}`,
    );
  }

  let updated = 0;
  let unchanged = 0;

  for (let i = 0; i < sortedCards.length; i++) {
    const target = sortedCards[i];
    const candidate = candidates[i];
    if (!target || !candidate) {
      continue;
    }

    if (target.tcgPlayerId === candidate.productId) {
      unchanged++;
      continue;
    }

    if (!dryRun) {
      await prisma.card.update({
        where: { id: target.id },
        data: { tcgPlayerId: candidate.productId },
      });
    }

    updated++;
  }

  console.log("\nDone.");
  console.log(`Cards in set: ${sortedCards.length}`);
  console.log(`IDs provided: ${candidates.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
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
