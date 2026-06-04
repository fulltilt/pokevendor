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

const normalizeCondition = (condition: unknown): ConditionKey | null => {
  if (typeof condition !== "string") return null;
  const raw = condition.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "nm" || raw.includes("near mint")) return "nm";
  if (
    raw === "lp" ||
    raw.includes("lightly played") ||
    raw.includes("light played")
  ) {
    return "lp";
  }
  if (
    raw === "mp" ||
    raw.includes("moderately played") ||
    raw.includes("moderate played")
  ) {
    return "mp";
  }
  return null;
};

const readEntryPrice = (entry: unknown): number | null => {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as {
    marketPrice?: unknown;
    price?: unknown;
    value?: unknown;
    buckets?: Array<{ marketPrice?: unknown; price?: unknown }>;
  };

  const direct = toFiniteNumber(e.marketPrice ?? e.price ?? e.value);
  if (direct !== null) return direct;

  if (Array.isArray(e.buckets) && e.buckets.length > 0) {
    return toFiniteNumber(e.buckets[0]?.marketPrice ?? e.buckets[0]?.price);
  }

  return null;
};

const applyResultArrayPrices = (prices: PriceMap, result: unknown): void => {
  if (!Array.isArray(result)) return;

  for (const row of result) {
    const condition = normalizeCondition(
      (row as { condition?: unknown } | null)?.condition,
    );
    if (!condition) continue;

    const parsed = readEntryPrice(row);
    if (parsed !== null) {
      prices[condition] = parsed;
    }
  }
};

const applyObjectPrices = (prices: PriceMap, rawPrices: unknown): void => {
  if (!rawPrices || typeof rawPrices !== "object") return;

  const p = rawPrices as Record<string, unknown>;
  const nm = toFiniteNumber(p.nm);
  const lp = toFiniteNumber(p.lp);
  const mp = toFiniteNumber(p.mp);

  if (nm !== null) prices.nm = nm;
  if (lp !== null) prices.lp = lp;
  if (mp !== null) prices.mp = mp;
};

const applyTopLevelPrice = (prices: PriceMap, marketPrice: unknown): void => {
  if (prices.nm !== null) return;
  const fallbackNm = toFiniteNumber(marketPrice);
  if (fallbackNm !== null) {
    prices.nm = fallbackNm;
  }
};

const parseLivePrices = (payload: unknown): PriceMap => {
  const prices = emptyPrices();
  if (!payload || typeof payload !== "object") return prices;

  const data = payload as {
    result?: unknown;
    prices?: unknown;
    marketPrice?: unknown;
  };

  applyResultArrayPrices(prices, data.result);
  applyObjectPrices(prices, data.prices);
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
        console.log(`[PRICE] Returning live prices:`, prices);
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
