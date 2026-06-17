#!/usr/bin/env node

/**
 * 1. Import cards from TCGDex API for specified sets
 * Usage: npx ts-node scripts/import-tcgdex-cards.ts [setname[:cardCount]] ...
 *
 * Examples:
 * Import all cards from sets me03 and me04 using default counts:
 *   npx ts-node scripts/import-tcgdex-cards.ts me03 me04
 * Or with explicit set info: npx ts-node scripts/import-tcgdex-cards.ts me03:124 me04:122
 *
 * Note:
 * get setId and set count from: https://api.tcgdex.net/v2/en/sets
 *
 * 
 * 2. Get TCG Player ids
-google "[set name] price guide" to get TCG Player set links

const links = Array.from(document.querySelectorAll('a[href^="/product/"]'));
const xValues = links
  .map((link) => {
    const match = link?.getAttribute("href")?.match(/^\/product\/([^/]+)\//);
    return match ? match[1] : null;
  })
  .filter(Boolean) // Remove nulls
  .filter((_, i) => i % 2 === 0);
console.log(xValues);

Run the script in TCG Player (google "[set name] price guide") and sort by number. Remove the code card ids at the beginning. This is 


 * 3. Sync TCG Player ids to cards in database using sync-tcgplayer-ids.ts
npm run sync:tcgplayer-ids -- \
  --set-id [set id] \
  --ids-file ./[set id].json
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from apps/api if DATABASE_URL not already set
if (!process.env.DATABASE_URL) {
  config({ path: resolve(process.cwd(), "apps/api/.env") });
}

interface SetConfig {
  setId: string;
  cardCount: number;
}

interface TcgDexLikeCard {
  localId?: unknown;
  image?: unknown;
  images?: unknown;
  number?: unknown;
  tcgPlayerId?: unknown;
  pricing?: {
    tcgplayer?: {
      normal?: { productId?: unknown };
      [key: string]: unknown;
    };
  };
  set?: unknown;
  [key: string]: unknown;
}

const prisma = new PrismaClient();

const TCGDEX_API = "https://api.tcgdex.net/v2/en/cards";

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const deriveTcgPlayerId = (cardData: TcgDexLikeCard): string | null => {
  const explicit = toStringOrNull(cardData.tcgPlayerId);
  if (explicit) return explicit;

  const normalProductId = toStringOrNull(
    cardData.pricing?.tcgplayer?.normal?.productId,
  );
  if (normalProductId) return normalProductId;

  return null;
};

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const normalizeCardData = (rawCardData: TcgDexLikeCard): TcgDexLikeCard => {
  const normalized: TcgDexLikeCard = { ...rawCardData };

  const localId = toStringOrNull(rawCardData.localId);
  const currentNumber = toStringOrNull(rawCardData.number);
  if (!currentNumber && localId) {
    normalized.number = localId;
  }

  // TCGDex returns a base image URL (no extension). Append quality suffixes
  // so the UI can use images.small and images.large directly.
  const hasImagesObject =
    !!rawCardData.images && typeof rawCardData.images === "object";
  const imageUrl = toStringOrNull(rawCardData.image);
  if (!hasImagesObject && imageUrl) {
    normalized.images = {
      small: `${imageUrl}/low.webp`,
      large: `${imageUrl}/high.webp`,
    };
  } else if (hasImagesObject) {
    // Already an images object — ensure URLs have quality suffixes if missing
    const imgs = rawCardData.images as { small?: string; large?: string };
    const needsSmallSuffix =
      imgs.small && !imgs.small.match(/\.(webp|png|jpg|jpeg)$/i);
    const needsLargeSuffix =
      imgs.large && !imgs.large.match(/\.(webp|png|jpg|jpeg)$/i);
    if (needsSmallSuffix || needsLargeSuffix) {
      normalized.images = {
        small: needsSmallSuffix ? `${imgs.small}/low.webp` : imgs.small,
        large: needsLargeSuffix ? `${imgs.large}/high.webp` : imgs.large,
      };
    }
  }

  return normalized;
};

/**
 * Fetch card data from TCGDex API
 */
async function fetchCardData(cardId: string) {
  try {
    const response = await fetch(`${TCGDEX_API}/${cardId}`);
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`  ⊘ Card ${cardId} not found`);
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`  ✗ Failed to fetch ${cardId}:`, error);
    return null;
  }
}

/**
 * Import cards for a single set
 */
async function importSetCards(setId: string, cardCount: number) {
  console.log(`\n📦 Importing ${cardCount} cards for set ${setId}...`);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 1; i <= cardCount; i++) {
    const cardNumber = String(i).padStart(3, "0");
    const cardId = `${setId}-${cardNumber}`;

    process.stdout.write(`  [${i}/${cardCount}] Fetching ${cardId}... `);

    const cardData = await fetchCardData(cardId);

    if (!cardData) {
      failed++;
      console.log("✗");
      continue;
    }

    try {
      const normalizedData = normalizeCardData(cardData as TcgDexLikeCard);
      const normalizedDataJson = toPrismaJson(normalizedData);
      const normalizedTcgPlayerId = deriveTcgPlayerId(normalizedData);

      const existingCard = await prisma.card.findUnique({
        where: { id: cardId },
      });

      if (existingCard) {
        const shouldUpdateData =
          JSON.stringify(existingCard.data) !==
          JSON.stringify(normalizedDataJson);
        const shouldUpdateTcg =
          (existingCard.tcgPlayerId ?? null) !== normalizedTcgPlayerId;

        if (!shouldUpdateData && !shouldUpdateTcg) {
          console.log("(already normalized)");
          skipped++;
          continue;
        }

        await prisma.card.update({
          where: { id: cardId },
          data: {
            data: normalizedDataJson,
            tcgPlayerId: normalizedTcgPlayerId,
          },
        });

        console.log("↺ updated");
        updated++;
        continue;
      }

      await prisma.card.create({
        data: {
          id: cardId,
          data: normalizedDataJson,
          tcgPlayerId: normalizedTcgPlayerId,
        },
      });

      console.log("✓");
      imported++;
    } catch (error) {
      console.error(`✗ (database error)`);
      console.error(
        `    Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      failed++;
    }

    // Rate limiting: 100ms between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { imported, updated, skipped, failed };
}

/**
 * Parse command line arguments
 * Format: "me03" or "me03:124"
 */
function parseSetConfig(arg: string): SetConfig {
  const [setId, countStr] = arg.split(":");

  // Known set card counts
  const knownCounts: Record<string, number> = {
    me01: 112,
    me02: 114,
    me03: 124,
    me04: 122,
  };

  const cardCount = countStr
    ? parseInt(countStr, 10)
    : knownCounts[setId] || 100;

  return { setId, cardCount };
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      "Usage: npx ts-node scripts/import-tcgdex-cards.ts <setId> [setId2] ...",
    );
    console.error(
      "Example: npx ts-node scripts/import-tcgdex-cards.ts me03 me04",
    );
    console.error(
      "Example: npx ts-node scripts/import-tcgdex-cards.ts me03:124 me04:122",
    );
    process.exit(1);
  }

  const sets = args.map(parseSetConfig);

  console.log("🚀 TCGDex Card Importer");
  console.log(`📋 Sets to import: ${sets.map((s) => s.setId).join(", ")}`);

  let totalImported = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  try {
    for (const set of sets) {
      const { imported, updated, skipped, failed } = await importSetCards(
        set.setId,
        set.cardCount,
      );
      totalImported += imported;
      totalUpdated += updated;
      totalSkipped += skipped;
      totalFailed += failed;
    }

    console.log("\n✨ Import Complete!");
    console.log(`   ✓ Imported: ${totalImported}`);
    console.log(`   ↺ Updated: ${totalUpdated}`);
    console.log(`   ⊘ Skipped: ${totalSkipped}`);
    console.log(`   ✗ Failed: ${totalFailed}`);
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
