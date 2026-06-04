import { Router, type Request, type Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import axios from "axios";

const router = Router();
const prisma = new PrismaClient();

type ConditionKey = "nm" | "lp" | "mp";
type PriceMap = Record<ConditionKey, number | null>;

const emptyPrices = (): PriceMap => ({ nm: null, lp: null, mp: null });

const toFiniteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
};

const applyTopLevelPrice = (prices: PriceMap, marketPrice: unknown): void => {
  if (prices.nm !== null) return;
  const fallbackNm = toFiniteNumber(marketPrice);
  if (fallbackNm !== null) {
    prices.nm = fallbackNm;
  }
};

const pickBucketMarketPrice = (
  result: unknown,
  targetCondition: "near mint" | "lightly played" | "moderately played",
): number | null => {
  if (!Array.isArray(result)) return null;

  const row = result.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as {
      condition?: unknown;
      variant?: unknown;
      language?: unknown;
    };

    const condition = normalizeText(record.condition);
    const variant = normalizeText(record.variant);
    const language = normalizeText(record.language);

    return (
      condition === targetCondition &&
      variant === "holofoil" &&
      language === "english"
    );
  });

  if (!row || typeof row !== "object") return null;
  const buckets = (row as { buckets?: unknown }).buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) return null;

  const firstBucket = buckets[0] as { marketPrice?: unknown } | undefined;
  return toFiniteNumber(firstBucket?.marketPrice);
};

const parseLivePrices = (payload: unknown): PriceMap => {
  const prices = emptyPrices();
  if (!payload || typeof payload !== "object") return prices;

  const data = payload as {
    result?: unknown;
    marketPrice?: unknown;
  };

  prices.nm = pickBucketMarketPrice(data.result, "near mint");
  prices.lp = pickBucketMarketPrice(data.result, "lightly played");
  prices.mp = pickBucketMarketPrice(data.result, "moderately played");

  applyTopLevelPrice(prices, data.marketPrice);

  return prices;
};

const hasAnyPrice = (prices: PriceMap): boolean =>
  prices.nm !== null || prices.lp !== null || prices.mp !== null;

const getFallbackPricesFromDb = async (cardId: string): Promise<PriceMap> => {
  const latest = await prisma.priceEntry.findFirst({
    where: { cardId },
    orderBy: { date: "desc" },
    select: { price: true },
  });

  const fallback = toFiniteNumber(latest?.price);
  if (fallback === null) {
    return emptyPrices();
  }

  return {
    nm: fallback,
    lp: null,
    mp: null,
  };
};

// Search cards by name/ID
router.get("/search", async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const sortBy = req.query.sortBy === "dateAsc" ? "dateAsc" : "dateDesc";

    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "Query parameter required" });
    }

    if (Number.isNaN(limit) || Number.isNaN(offset)) {
      return res.status(400).json({ error: "Invalid limit/offset" });
    }

    const searchText = q.trim();
    const query = `%${searchText}%`;
    const fuzzyQuery = `%${searchText.split("").join("%")}%`;
    const orderClause =
      sortBy === "dateAsc"
        ? Prisma.sql`release_date ASC, relevance_score DESC, id ASC`
        : Prisma.sql`release_date DESC, relevance_score DESC, id ASC`;

    const cards = (await prisma.$queryRaw`
      WITH matched AS (
        SELECT
          id,
          data,
          "tcgPlayerId",
          COALESCE(TO_DATE(NULLIF(data #>> '{set,releaseDate}', ''), 'YYYY/MM/DD'), DATE '1900-01-01') AS release_date,
          CASE
            WHEN lower(data->>'name') = lower(${searchText}) OR lower(data->>'number') = lower(${searchText}) THEN 100
            WHEN data->>'name' ILIKE ${query} OR data->>'number' ILIKE ${query} THEN 75
            WHEN data->>'name' ILIKE ${fuzzyQuery} OR data->>'number' ILIKE ${fuzzyQuery} THEN 50
            WHEN id ILIKE ${query} THEN 30
            ELSE 0
          END AS relevance_score
        FROM "Card"
        WHERE id ILIKE ${query}
           OR data->>'name' ILIKE ${query}
           OR data->>'number' ILIKE ${query}
           OR data->>'name' ILIKE ${fuzzyQuery}
           OR data->>'number' ILIKE ${fuzzyQuery}
      )
      SELECT id, data, "tcgPlayerId"
      FROM matched
      ORDER BY ${orderClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `) as Array<{ id: string; data: unknown; tcgPlayerId: string | null }>;

    const totalRows = (await prisma.$queryRaw`
      SELECT COUNT(*)::int AS total
      FROM "Card"
      WHERE id ILIKE ${query}
         OR data->>'name' ILIKE ${query}
         OR data->>'number' ILIKE ${query}
         OR data->>'name' ILIKE ${fuzzyQuery}
         OR data->>'number' ILIKE ${fuzzyQuery}
    `) as Array<{ total: number }>;

    const total = totalRows[0]?.total ?? 0;

    res.json({ cards, total, limit, offset, sortBy });
  } catch (error) {
    console.error("Card search failed:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

// Fetch live market prices for NM / LP / MP from TCGPlayer
router.get("/:id/prices", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log(`[PRICE] Fetching card ${id}`);

    const card = await prisma.card.findUnique({
      where: { id },
      select: { tcgPlayerId: true, data: true },
    });

    if (!card) {
      console.log(`[PRICE] Card ${id} not found`);
      return res.status(404).json({ error: "Card not found" });
    }

    const tcgUrl = card.tcgPlayerId
      ? `https://www.tcgplayer.com/product/${card.tcgPlayerId}`
      : null;

    if (!card.tcgPlayerId) {
      console.log(`[PRICE] Card ${id} has no tcgPlayerId, using DB fallback`);
      const fallbackPrices = await getFallbackPricesFromDb(id);
      return res.json({ prices: fallbackPrices, tcgPlayerId: null, tcgUrl });
    }

    try {
      console.log(
        `[PRICE] Fetching from TCGPlayer API for ID ${card.tcgPlayerId}`,
      );
      const priceRes = await axios.get(
        `https://infinite-api.tcgplayer.com/price/history/${card.tcgPlayerId}/detailed?range=month`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          timeout: 8000,
        },
      );

      const prices = parseLivePrices(priceRes.data);
      if (hasAnyPrice(prices)) {
        return res.json({ prices, tcgPlayerId: card.tcgPlayerId, tcgUrl });
      }

      console.log(
        `[PRICE] Live response had no usable prices, using DB fallback`,
      );
      const fallbackPrices = await getFallbackPricesFromDb(id);
      return res.json({
        prices: fallbackPrices,
        tcgPlayerId: card.tcgPlayerId,
        tcgUrl,
      });
    } catch (error) {
      console.error(`[PRICE] Error fetching from TCGPlayer:`, error);
      const fallbackPrices = await getFallbackPricesFromDb(id);
      return res.json({
        prices: fallbackPrices,
        tcgPlayerId: card.tcgPlayerId,
        tcgUrl,
      });
    }
  } catch (error) {
    console.error("[PRICE] Card price fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

// Get card details by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const card = await prisma.card.findUnique({
      where: { id },
      include: { prices: true },
    });

    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }

    res.json(card);
  } catch {
    res.status(500).json({ error: "Failed to fetch card" });
  }
});

export default router;
