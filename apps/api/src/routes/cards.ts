import { Router, type Request, type Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import axios from "axios";
import sharp from "sharp";
import multer from "multer";
import {
  computeVisionEmbeddingFromBuffer,
  toPgVectorLiteral,
} from "../lib/visionEmbedding.js";

const router = Router();
const prisma = new PrismaClient();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

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

type RecognizeBody = {
  imageUrl?: unknown;
  topK?: unknown;
  setId?: unknown;
  embeddingSource?: unknown;
  hashFallbackTopK?: unknown;
};

const toImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
};

const toPositiveInt = (
  value: unknown,
  fallback: number,
  max: number,
): number => {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
};

const loadGrayscalePixels = async (
  imageInput: Buffer,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const output = await sharp(imageInput)
    .rotate()
    .grayscale()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  return output;
};

const loadImageBufferFromUrl = async (imageUrl: string): Promise<Buffer> => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image (HTTP ${response.status})`);
  }

  const arrBuf = await response.arrayBuffer();
  return Buffer.from(arrBuf);
};

const parseOptionalText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

type RecognitionInput = {
  imageBuffer: Buffer;
  source: "upload" | "url";
  imageUrl: string | null;
};

const resolveRecognitionInput = async (
  req: Request,
  body: RecognizeBody,
): Promise<RecognitionInput> => {
  const uploadedFile = req.file;
  if (uploadedFile?.buffer && uploadedFile.buffer.length > 0) {
    if (uploadedFile.mimetype && !uploadedFile.mimetype.startsWith("image/")) {
      throw new Error("Uploaded file must be an image.");
    }

    return {
      imageBuffer: uploadedFile.buffer,
      source: "upload",
      imageUrl: null,
    };
  }

  const imageUrl = toImageUrl(body.imageUrl);
  if (!imageUrl) {
    throw new Error(
      "Provide either multipart image field 'image' or JSON body imageUrl.",
    );
  }

  const imageBuffer = await loadImageBufferFromUrl(imageUrl);
  return {
    imageBuffer,
    source: "url",
    imageUrl,
  };
};

const dhash64 = (pixels: Uint8Array): string => {
  const width = 9;
  const height = 8;
  if (pixels.length !== width * height) {
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

const phash64 = (pixels: Uint8Array): string => {
  const width = 32;
  const height = 32;
  if (pixels.length !== width * height) {
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

const hammingDistance = (a: string, b: string): number => {
  const len = Math.min(a.length, b.length);
  let diff = Math.abs(a.length - b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) diff += 1;
  }
  return diff;
};

type CardRowLite = {
  id: string;
  data: unknown;
};

type CardDisplayData = {
  name: string | null;
  number: string | null;
  image: string | null;
};

const toCardDisplayData = (card: CardRowLite | undefined): CardDisplayData => {
  const data = card?.data as
    | {
        name?: unknown;
        number?: unknown;
        localId?: unknown;
        images?: { small?: unknown; large?: unknown };
      }
    | undefined;

  let number: string | null = null;
  if (typeof data?.number === "string") {
    number = data.number;
  } else if (typeof data?.localId === "string") {
    number = data.localId;
  }

  let image: string | null = null;
  if (typeof data?.images?.small === "string") {
    image = data.images.small;
  } else if (typeof data?.images?.large === "string") {
    image = data.images.large;
  }

  return {
    name: typeof data?.name === "string" ? data.name : null,
    number,
    image,
  };
};

type EmbeddingSearchRow = {
  cardId: string;
  similarity: number;
};

const embeddingAnnSearch = async (
  embedding: number[],
  topK: number,
  source: string,
): Promise<EmbeddingSearchRow[]> => {
  const vectorLiteral = toPgVectorLiteral(embedding);

  const rows = await prisma.$queryRaw<
    Array<{ cardId: string; similarity: number }>
  >`
    SELECT
      ce."cardId" AS "cardId",
      (1 - (ce.embedding <=> ${vectorLiteral}::vector)) AS similarity
    FROM "CardEmbedding" ce
    WHERE ce.source = ${source}
    ORDER BY ce.embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `;

  return rows
    .map((row) => ({
      cardId: row.cardId,
      similarity: Number(row.similarity),
    }))
    .filter(
      (row): row is EmbeddingSearchRow =>
        !!row.cardId && Number.isFinite(row.similarity),
    );
};

type HashFallbackMatch = {
  rank: number;
  cardId: string;
  name: string | null;
  number: string | null;
  image: string | null;
  distances: { phash: number; dhash: number; total: number };
};

const runHashFallbackRecognition = async (
  imageBuffer: Buffer,
  topK: number,
): Promise<HashFallbackMatch[]> => {
  const dhPixels = await loadGrayscalePixels(imageBuffer, 9, 8);
  const phPixels = await loadGrayscalePixels(imageBuffer, 32, 32);
  const queryDHash = dhash64(dhPixels);
  const queryPHash = phash64(phPixels);

  const hashRows = await prisma.cardHash.findMany({
    where: {
      variant: "v1-64",
      algorithm: { in: ["phash", "dhash"] },
    },
    select: {
      cardId: true,
      algorithm: true,
      hash: true,
    },
  });

  const byCard = new Map<
    string,
    { phash: string | null; dhash: string | null }
  >();
  for (const row of hashRows) {
    const current = byCard.get(row.cardId) ?? { phash: null, dhash: null };
    if (row.algorithm === "phash") current.phash = row.hash;
    if (row.algorithm === "dhash") current.dhash = row.hash;
    byCard.set(row.cardId, current);
  }

  const scored = [...byCard.entries()]
    .map(([cardId, hashes]) => {
      const pDist = hashes.phash
        ? hammingDistance(queryPHash, hashes.phash)
        : 64;
      const dDist = hashes.dhash
        ? hammingDistance(queryDHash, hashes.dhash)
        : 64;
      return { cardId, pDist, dDist, score: pDist + dDist };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, topK);

  const fallbackCardIds = scored.map((row) => row.cardId);
  const fallbackCards = await prisma.card.findMany({
    where: { id: { in: fallbackCardIds } },
    select: { id: true, data: true },
  });
  const fallbackMap = new Map(fallbackCards.map((card) => [card.id, card]));

  return scored.map((row, index) => {
    const display = toCardDisplayData(fallbackMap.get(row.cardId));
    return {
      rank: index + 1,
      cardId: row.cardId,
      ...display,
      distances: {
        phash: row.pDist,
        dhash: row.dDist,
        total: row.score,
      },
    };
  });
};

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

// Stage 1 image recognition MVP: hash photo URL and return nearest cards.
router.post(
  "/recognize",
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as RecognizeBody;
      const topK = toPositiveInt(body.topK, 20, 100);
      const setId = parseOptionalText(body.setId);
      const recognitionInput = await resolveRecognitionInput(req, body);

      const dhPixels = await loadGrayscalePixels(
        recognitionInput.imageBuffer,
        9,
        8,
      );
      const phPixels = await loadGrayscalePixels(
        recognitionInput.imageBuffer,
        32,
        32,
      );
      const queryDHash = dhash64(dhPixels);
      const queryPHash = phash64(phPixels);

      const hashRows = await prisma.cardHash.findMany({
        where: {
          variant: "v1-64",
          algorithm: { in: ["phash", "dhash"] },
          ...(setId ? { cardId: { startsWith: `${setId}-` } } : {}),
        },
        select: {
          cardId: true,
          algorithm: true,
          hash: true,
        },
      });

      const byCard = new Map<
        string,
        { phash: string | null; dhash: string | null }
      >();

      for (const row of hashRows) {
        const current = byCard.get(row.cardId) ?? { phash: null, dhash: null };
        if (row.algorithm === "phash") {
          current.phash = row.hash;
        } else if (row.algorithm === "dhash") {
          current.dhash = row.hash;
        }
        byCard.set(row.cardId, current);
      }

      const scored = [...byCard.entries()].map(([cardId, hashes]) => {
        const pDist = hashes.phash
          ? hammingDistance(queryPHash, hashes.phash)
          : 64;
        const dDist = hashes.dhash
          ? hammingDistance(queryDHash, hashes.dhash)
          : 64;

        return {
          cardId,
          pDist,
          dDist,
          score: pDist + dDist,
        };
      });

      scored.sort((a, b) => a.score - b.score);
      const top = scored.slice(0, topK);

      const cardIds = top.map((row) => row.cardId);
      const cards = await prisma.card.findMany({
        where: { id: { in: cardIds } },
        select: { id: true, data: true },
      });

      const cardMap = new Map(cards.map((card) => [card.id, card]));

      const matches = top.map((row) => {
        const card = cardMap.get(row.cardId);
        const display = toCardDisplayData(card);

        return {
          cardId: row.cardId,
          ...display,
          distances: {
            phash: row.pDist,
            dhash: row.dDist,
            total: row.score,
          },
        };
      });

      return res.json({
        query: {
          source: recognitionInput.source,
          imageUrl: recognitionInput.imageUrl,
          setId: setId || null,
          topK,
          hashes: {
            phash: queryPHash,
            dhash: queryDHash,
          },
        },
        scannedCards: byCard.size,
        matches,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Recognition failed";
      if (message.includes("Provide either multipart image")) {
        return res.status(400).json({ error: message });
      }
      if (message.includes("Uploaded file must be an image.")) {
        return res.status(400).json({ error: message });
      }

      console.error("Recognize failed:", error);
      return res.status(500).json({ error: "Recognition failed" });
    }
  },
);

router.post(
  "/recognize-embedding",
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as RecognizeBody;
      const topK = toPositiveInt(body.topK, 20, 100);
      const hashFallbackTopK = toPositiveInt(body.hashFallbackTopK, topK, 100);
      const recognitionInput = await resolveRecognitionInput(req, body);
      const embeddingSource =
        parseOptionalText(body.embeddingSource) || "vision-v1";

      const queryEmbedding = await computeVisionEmbeddingFromBuffer(
        recognitionInput.imageBuffer,
      );

      const annRows = await embeddingAnnSearch(
        queryEmbedding,
        topK,
        embeddingSource,
      );

      if (annRows.length === 0) {
        const fallbackMatches = await runHashFallbackRecognition(
          recognitionInput.imageBuffer,
          hashFallbackTopK,
        );

        return res.json({
          query: {
            source: recognitionInput.source,
            imageUrl: recognitionInput.imageUrl,
            topK,
            embeddingSource,
            embeddingDims: queryEmbedding.length,
          },
          mode: "hash-fallback",
          matches: fallbackMatches,
        });
      }

      const cardIds = annRows.map((row) => row.cardId);
      const cards = await prisma.card.findMany({
        where: { id: { in: cardIds } },
        select: { id: true, data: true },
      });
      const cardMap = new Map(cards.map((card) => [card.id, card]));

      const matches = annRows.map((row, index) => {
        const card = cardMap.get(row.cardId);
        const display = toCardDisplayData(card);
        return {
          rank: index + 1,
          cardId: row.cardId,
          ...display,
          similarity: row.similarity,
        };
      });

      return res.json({
        query: {
          source: recognitionInput.source,
          imageUrl: recognitionInput.imageUrl,
          topK,
          embeddingSource,
          embeddingDims: queryEmbedding.length,
        },
        mode: "embedding-ann",
        scannedCards: annRows.length,
        matches,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Embedding recognition failed";
      if (message.includes("Provide either multipart image")) {
        return res.status(400).json({ error: message });
      }
      if (message.includes("Uploaded file must be an image.")) {
        return res.status(400).json({ error: message });
      }

      console.error("Recognize embedding failed:", error);
      return res.status(500).json({ error: "Embedding recognition failed" });
    }
  },
);

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
          COALESCE(
            TO_DATE(NULLIF(data #>> '{set,releaseDate}', ''), 'YYYY/MM/DD'),
            TO_DATE(NULLIF(SUBSTRING(data->>'updated' FROM 1 FOR 10), ''), 'YYYY-MM-DD'),
            DATE '1900-01-01'
          ) AS release_date,
          CASE
            WHEN lower(data->>'name') = lower(${searchText}) OR lower(COALESCE(data->>'number', data->>'localId', '')) = lower(${searchText}) THEN 100
            WHEN data->>'name' ILIKE ${query} OR COALESCE(data->>'number', data->>'localId', '') ILIKE ${query} THEN 75
            WHEN data->>'name' ILIKE ${fuzzyQuery} OR COALESCE(data->>'number', data->>'localId', '') ILIKE ${fuzzyQuery} THEN 50
            WHEN id ILIKE ${query} THEN 30
            ELSE 0
          END AS relevance_score
        FROM "Card"
        WHERE id ILIKE ${query}
           OR data->>'name' ILIKE ${query}
           OR COALESCE(data->>'number', data->>'localId', '') ILIKE ${query}
           OR data->>'name' ILIKE ${fuzzyQuery}
           OR COALESCE(data->>'number', data->>'localId', '') ILIKE ${fuzzyQuery}
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
          OR COALESCE(data->>'number', data->>'localId', '') ILIKE ${query}
         OR data->>'name' ILIKE ${fuzzyQuery}
          OR COALESCE(data->>'number', data->>'localId', '') ILIKE ${fuzzyQuery}
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
