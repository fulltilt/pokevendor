#!/usr/bin/env node

/**
 * Sync tcgPlayerId values for cards in a set from a TCGPlayer price guide URL.
 *
 * Usage:
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --url <guideUrl> --set-id <setId>
 *
 * Examples:
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --url "https://www.tcgplayer.com/categories/trading-and-collectible-card-games/pokemon/price-guides/me02-phantasmal-flames" --set-id me02
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --url "..." --set-id me02 --dry-run
 *   node --import tsx scripts/sync-tcgplayer-ids.ts --url "..." --set-id me02 --force
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve } from "path";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(import.meta.dirname, "../apps/api/.env") });
}

type Candidate = {
  productId: string;
  name: string | null;
  number: string | null;
};

type CardRow = {
  id: string;
  tcgPlayerId: string | null;
  data: unknown;
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

const normalizeName = (name: string | null): string | null => {
  if (!name) return null;
  const normalized = name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  return normalized || null;
};

const normalizeNumber = (num: string | null): string | null => {
  if (!num) return null;
  const firstSegment = num.split("/")[0]?.trim() ?? "";
  const clean = firstSegment.replace(/[^a-zA-Z0-9]/g, "");
  if (!clean) return null;

  const parsed = Number.parseInt(clean, 10);
  if (Number.isFinite(parsed)) {
    return String(parsed);
  }

  return clean.toLowerCase();
};

const parseJsonSafe = (raw: string): unknown | null => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const pickName = (obj: Record<string, unknown>): string | null => {
  const nameKeys = [
    "name",
    "productName",
    "cleanName",
    "title",
    "productTitle",
  ];
  for (const key of nameKeys) {
    const v = toStringOrNull(obj[key]);
    if (v) return v;
  }
  return null;
};

const pickNumber = (obj: Record<string, unknown>): string | null => {
  const numberKeys = [
    "number",
    "cardNumber",
    "localId",
    "setNumber",
    "collectorNumber",
  ];
  for (const key of numberKeys) {
    const v = toStringOrNull(obj[key]);
    if (v) return v;
  }
  return null;
};

const collectCandidatesFromNode = (
  node: unknown,
  out: Candidate[],
  seen: Set<string>,
): void => {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectCandidatesFromNode(entry, out, seen);
    }
    return;
  }

  const obj = node as Record<string, unknown>;

  const productId =
    toStringOrNull(obj.productId) ??
    toStringOrNull(obj.productID) ??
    toStringOrNull(obj.tcgplayerProductId) ??
    toStringOrNull(obj.tcgPlayerId);

  if (productId && /^\d+$/.test(productId)) {
    const fingerprint = `${productId}::${toStringOrNull(obj.number) ?? ""}::${toStringOrNull(obj.name) ?? ""}`;
    if (!seen.has(fingerprint)) {
      out.push({
        productId,
        name: pickName(obj),
        number: pickNumber(obj),
      });
      seen.add(fingerprint);
    }
  }

  for (const value of Object.values(obj)) {
    collectCandidatesFromNode(value, out, seen);
  }
};

const extractCandidatesFromHtml = (html: string): Candidate[] => {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nextDataMatch?.[1]) {
    const parsed = parseJsonSafe(nextDataMatch[1]);
    if (parsed) {
      collectCandidatesFromNode(parsed, candidates, seen);
    }
  }

  const jsonScriptRegex =
    /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(jsonScriptRegex)) {
    const payload = match[1] ?? "";
    const parsed = parseJsonSafe(payload);
    if (parsed) {
      collectCandidatesFromNode(parsed, candidates, seen);
    }
  }

  // Fallback for product URLs embedded in HTML. This may not include name/number.
  const productUrlRegex = /\/product\/(\d+)\//gi;
  for (const match of html.matchAll(productUrlRegex)) {
    const productId = match[1];
    const key = `${productId}::::`;
    if (!seen.has(key)) {
      candidates.push({ productId, name: null, number: null });
      seen.add(key);
    }
  }

  return candidates;
};

const getCardNumberFromData = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const directNumber = toStringOrNull(obj.number);
  if (directNumber) return directNumber;

  const localId = toStringOrNull(obj.localId);
  if (localId) return localId;

  return null;
};

const getCardNameFromData = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  return toStringOrNull(obj.name);
};

const parseArgs = (): {
  url: string;
  setId: string;
  dryRun: boolean;
  force: boolean;
} => {
  const args = process.argv.slice(2);

  const getValue = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  const url = getValue("--url") ?? getValue("-u");
  const setId = getValue("--set-id") ?? getValue("-s");
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  if (!url || !setId) {
    console.error(
      "Usage: node --import tsx scripts/sync-tcgplayer-ids.ts --url <guideUrl> --set-id <setId> [--dry-run] [--force]",
    );
    process.exit(1);
  }

  return { url, setId, dryRun, force };
};

const main = async () => {
  const { url, setId, dryRun, force } = parseArgs();

  console.log("Syncing TCGPlayer IDs from guide page");
  console.log(`Set ID: ${setId}`);
  console.log(`Guide URL: ${url}`);
  console.log(
    `Mode: ${dryRun ? "dry-run" : "write"}${force ? " (force overwrite)" : ""}`,
  );

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch guide page: HTTP ${response.status}`);
  }

  const html = await response.text();
  const candidates = extractCandidatesFromHtml(html);

  if (candidates.length === 0) {
    throw new Error(
      "No product candidates found in the page. The guide payload may require a different endpoint or stronger anti-bot handling.",
    );
  }

  console.log(`Extracted ${candidates.length} guide candidates`);

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
      data: true,
    },
  })) as CardRow[];

  if (cards.length === 0) {
    throw new Error(`No cards found in DB for set prefix ${setPrefix}`);
  }

  console.log(`Loaded ${cards.length} DB cards for set ${setId}`);

  const numberIndex = new Map<string, CardRow[]>();
  const nameIndex = new Map<string, CardRow[]>();

  for (const card of cards) {
    const n = normalizeNumber(getCardNumberFromData(card.data));
    if (n) {
      const arr = numberIndex.get(n) ?? [];
      arr.push(card);
      numberIndex.set(n, arr);
    }

    const nm = normalizeName(getCardNameFromData(card.data));
    if (nm) {
      const arr = nameIndex.get(nm) ?? [];
      arr.push(card);
      nameIndex.set(nm, arr);
    }
  }

  let matched = 0;
  let updated = 0;
  let alreadySet = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const candidate of candidates) {
    const cNumber = normalizeNumber(candidate.number);
    const cName = normalizeName(candidate.name);

    let target: CardRow | null = null;

    if (cNumber) {
      const byNumber = numberIndex.get(cNumber) ?? [];
      if (byNumber.length === 1) {
        target = byNumber[0];
      } else if (byNumber.length > 1) {
        ambiguous++;
        continue;
      }
    }

    if (!target && cName) {
      const byName = nameIndex.get(cName) ?? [];
      if (byName.length === 1) {
        target = byName[0];
      } else if (byName.length > 1) {
        ambiguous++;
        continue;
      }
    }

    if (!target) {
      unmatched++;
      continue;
    }

    matched++;

    if (target.tcgPlayerId && !force) {
      alreadySet++;
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
  console.log(`Matched: ${matched}`);
  console.log(`Updated: ${updated}`);
  console.log(`Already set (skipped): ${alreadySet}`);
  console.log(`Ambiguous: ${ambiguous}`);
  console.log(`Unmatched: ${unmatched}`);
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
