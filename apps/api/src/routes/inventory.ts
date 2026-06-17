import { Router, type Request, type Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

const toFiniteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const maybeRecordPriceSnapshot = async (params: {
  cardId: string;
  type: string | null | undefined;
  previousPrice: number | null;
  nextPriceRaw: unknown;
}): Promise<void> => {
  const normalizedType = (params.type ?? "card").toLowerCase();
  if (normalizedType !== "card") {
    return;
  }

  const nextPrice = toFiniteNumber(params.nextPriceRaw);
  if (nextPrice === null) {
    return;
  }

  if (
    params.previousPrice !== null &&
    Math.abs(params.previousPrice - nextPrice) < 0.0001
  ) {
    return;
  }

  await prisma.priceEntry.create({
    data: {
      cardId: params.cardId,
      date: new Date(),
      price: nextPrice,
    },
  });
};

const csvField = (value: string): string => `"${value.replace(/"/g, '""')}"`;

type ExportOptionsResult =
  | {
      ok: true;
      sinceRaw: string;
      sinceDate: Date;
      threshold: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

type ExportInventoryItem = {
  cardId: string;
  condition: string | null;
  notes: string | null;
  priceCurrentAsk: number | null;
  pricePurchasedAt: number;
  card: { data: unknown } | null;
};

const parseExportOptions = (req: Request): ExportOptionsResult => {
  const sinceRaw = typeof req.query.since === "string" ? req.query.since : "";
  const thresholdRaw = Number(req.query.threshold ?? 3);
  const threshold = Number.isFinite(thresholdRaw)
    ? Math.max(thresholdRaw, 0)
    : 3;

  if (!sinceRaw) {
    return {
      ok: false,
      status: 400,
      error: "Missing required query parameter: since",
    };
  }

  const sinceDate = new Date(`${sinceRaw}T00:00:00.000Z`);
  if (Number.isNaN(sinceDate.getTime())) {
    return {
      ok: false,
      status: 400,
      error: "Invalid since date. Use YYYY-MM-DD.",
    };
  }

  return { ok: true, sinceRaw, sinceDate, threshold };
};

const makeCsvResponseHeaders = (res: Response, sinceRaw: string): void => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=price-moves-since-${sinceRaw}.csv`,
  );
};

const emptyPriceMovesCsv =
  "Card,Card ID,Condition,Baseline Price,Current Price,Change,Percent Change,Since Date\n";

const buildBaselineMap = async (
  cardIds: string[],
  sinceDate: Date,
): Promise<Map<string, number>> => {
  const priceEntriesSince = await prisma.priceEntry.findMany({
    where: {
      cardId: { in: cardIds },
      date: { gte: sinceDate },
    },
    orderBy: [{ cardId: "asc" }, { date: "asc" }],
    select: { cardId: true, price: true },
  });

  const latestBeforeSince = await prisma.priceEntry.findMany({
    where: {
      cardId: { in: cardIds },
      date: { lt: sinceDate },
    },
    orderBy: [{ cardId: "asc" }, { date: "desc" }],
    select: { cardId: true, price: true },
  });

  const baselineByCardId = new Map<string, number>();
  for (const entry of priceEntriesSince) {
    if (!baselineByCardId.has(entry.cardId)) {
      baselineByCardId.set(entry.cardId, entry.price);
    }
  }
  for (const entry of latestBeforeSince) {
    if (!baselineByCardId.has(entry.cardId)) {
      baselineByCardId.set(entry.cardId, entry.price);
    }
  }

  return baselineByCardId;
};

const buildPriceMovesCsv = (
  inventoryItems: ExportInventoryItem[],
  baselineByCardId: Map<string, number>,
  sinceRaw: string,
  threshold: number,
): string => {
  const csvLines: string[] = [
    "Card,Card ID,Condition,Baseline Price,Current Price,Change,Percent Change,Since Date",
  ];

  for (const item of inventoryItems) {
    const baselinePrice = baselineByCardId.get(item.cardId);
    if (baselinePrice === undefined) {
      continue;
    }

    const currentPrice =
      toFiniteNumber(item.priceCurrentAsk) ??
      toFiniteNumber(item.pricePurchasedAt);
    if (currentPrice === null) {
      continue;
    }

    const delta = currentPrice - baselinePrice;
    if (Math.abs(delta) < threshold) {
      continue;
    }

    const percent = baselinePrice > 0 ? (delta / baselinePrice) * 100 : null;
    const cardData = (item.card?.data ?? {}) as { name?: string };
    const cardName =
      typeof cardData.name === "string" && cardData.name.trim().length > 0
        ? cardData.name
        : item.cardId;
    const condition = item.condition ?? "NM";

    csvLines.push(
      [
        csvField(item.notes || cardName),
        csvField(item.cardId),
        csvField(condition),
        baselinePrice.toFixed(2),
        currentPrice.toFixed(2),
        delta.toFixed(2),
        percent === null ? "N/A" : `${percent.toFixed(2)}%`,
        csvField(sinceRaw),
      ].join(","),
    );
  }

  return csvLines.join("\n");
};

const hasMissingExtendedFieldError = (error: unknown): boolean => {
  const message = String(error);
  return (
    message.includes("Unknown arg `condition`") ||
    message.includes("Unknown arg `type`") ||
    message.includes('column "condition" does not exist') ||
    message.includes('column "type" does not exist')
  );
};

const isManualEntry = (type: unknown, cardId: unknown): boolean => {
  const normalizedType =
    typeof type === "string" ? type.trim().toLowerCase() : "card";
  const normalizedCardId =
    typeof cardId === "string" ? cardId.trim().toLowerCase() : "";
  return normalizedType !== "card" || normalizedCardId.startsWith("manual-");
};

const ensureCardExistsForInventory = async (
  cardId: string,
  type: string,
  notes: unknown,
): Promise<"ok" | "missing-real-card"> => {
  const existing = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true },
  });

  if (existing) {
    return "ok";
  }

  if (!isManualEntry(type, cardId)) {
    return "missing-real-card";
  }

  const label =
    typeof notes === "string" && notes.trim().length > 0
      ? notes.trim()
      : cardId;

  await prisma.card.create({
    data: {
      id: cardId,
      tcgPlayerId: null,
      data: {
        name: label,
        number: null,
        images: {},
        set: {
          name: "Manual Entry",
          releaseDate: null,
        },
        manual: true,
        itemType: type,
      },
    },
  });

  return "ok";
};

// Add item to inventory
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      cardId,
      quantity = 1,
      type = "card",
      condition,
      storageType,
      pricePurchasedAt,
      purchasedAt,
      purchasedFrom,
      priceCurrentAsk,
      notes,
    } = req.body;

    const isMissingPurchasePrice =
      pricePurchasedAt === undefined ||
      pricePurchasedAt === null ||
      pricePurchasedAt === "";

    if (!cardId || !storageType || isMissingPurchasePrice || !purchasedAt) {
      return res.status(400).json({
        error:
          "Missing required fields: cardId, storageType, pricePurchasedAt, purchasedAt",
      });
    }

    const cardCheck = await ensureCardExistsForInventory(cardId, type, notes);
    if (cardCheck === "missing-real-card") {
      return res.status(400).json({
        error:
          "Card ID not found for card inventory item. Select a card from search or use manual item type.",
      });
    }

    const createData = {
      cardId,
      quantity,
      type,
      condition,
      storageType,
      pricePurchasedAt,
      purchasedAt: new Date(purchasedAt),
      purchasedFrom,
      priceCurrentAsk,
      notes,
    };

    try {
      const item = await prisma.inventoryItem.create({ data: createData });
      return res.json(item);
    } catch (error) {
      if (hasMissingExtendedFieldError(error)) {
        const fallbackItem = await prisma.inventoryItem.create({
          data: {
            cardId,
            quantity,
            storageType,
            pricePurchasedAt,
            purchasedAt: new Date(purchasedAt),
            purchasedFrom,
            priceCurrentAsk,
            notes,
          },
        });
        return res.json(fallbackItem);
      }
      throw error;
    }
  } catch (error) {
    console.error("[INVENTORY] Failed to add inventory item:", error);
    res.status(500).json({ error: "Failed to add inventory item" });
  }
});

// List inventory with filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { storageType } = req.query;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 2000);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const sortBy =
      typeof req.query.sortBy === "string" ? req.query.sortBy : null;
    const sortDirRaw = req.query.sortDir === "asc" ? "asc" : "desc";

    // Build WHERE clause for filtering
    const whereConditions: string[] = [];
    if (storageType && typeof storageType === "string") {
      whereConditions.push(`"storageType" = '${storageType}'`);
    }

    if (q) {
      const qEscaped = q.replace(/'/g, "''");
      // Search in: cardId, notes, and card name/number (via JSON data)
      whereConditions.push(
        `(LOWER("cardId") LIKE LOWER('%${qEscaped}%') OR LOWER(COALESCE("notes", '')) LIKE LOWER('%${qEscaped}%') OR EXISTS (SELECT 1 FROM "Card" WHERE "Card"."id" = "InventoryItem"."cardId" AND ("Card"."data"->>'name' ILIKE '%${qEscaped}%' OR "Card"."data"->>'number' ILIKE '%${qEscaped}%')))`,
      );
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Get total count
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "InventoryItem" ${whereClause}`,
    );
    const total = Number(countResult[0]?.count ?? 0);

    // Get total value
    const valueResult = await prisma.$queryRawUnsafe<[{ total: number }]>(
      `
      SELECT COALESCE(SUM(
        COALESCE("priceCurrentAsk", "pricePurchasedAt") * quantity
      ), 0)::float AS total
      FROM "InventoryItem"
      ${whereClause}
    `,
    );
    const totalValue = Number(valueResult[0]?.total ?? 0);

    // Determine sort order
    let orderClause = '"createdAt" DESC';
    if (sortBy === "condition") {
      orderClause = `"condition" ${sortDirRaw === "asc" ? "ASC" : "DESC"}`;
    } else if (sortBy === "priceCurrentAsk") {
      orderClause = `"priceCurrentAsk" ${sortDirRaw === "asc" ? "ASC" : "DESC"} NULLS LAST`;
    } else if (sortBy === "totalValue") {
      orderClause = `(COALESCE("priceCurrentAsk", "pricePurchasedAt") * quantity) ${sortDirRaw === "asc" ? "ASC" : "DESC"}`;
    }

    // Get items with pagination
    const itemIds = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `
      SELECT "id" FROM "InventoryItem"
      ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `,
    );

    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds.map((r) => r.id) } },
      include: { card: { include: { prices: true } } },
    });

    // Preserve order from the query
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const orderedItems = itemIds
      .map((r) => itemMap.get(r.id))
      .filter(Boolean) as typeof items;

    res.json({
      items: orderedItems,
      total,
      totalValue,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[INVENTORY] Failed to fetch inventory:", error);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

router.get("/price-moves/export", async (req: Request, res: Response) => {
  try {
    const options = parseExportOptions(req);
    if (!options.ok) {
      return res.status(options.status).json({ error: options.error });
    }

    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { type: "card" },
      include: {
        card: {
          select: {
            data: true,
          },
        },
      },
    });

    if (!inventoryItems.length) {
      makeCsvResponseHeaders(res, options.sinceRaw);
      return res.send(emptyPriceMovesCsv);
    }

    const cardIds = Array.from(
      new Set(inventoryItems.map((item) => item.cardId)),
    );
    const baselineByCardId = await buildBaselineMap(cardIds, options.sinceDate);
    const csv = buildPriceMovesCsv(
      inventoryItems,
      baselineByCardId,
      options.sinceRaw,
      options.threshold,
    );

    makeCsvResponseHeaders(res, options.sinceRaw);
    return res.send(csv);
  } catch (error) {
    console.error("[INVENTORY] Failed to export price moves:", error);
    return res.status(500).json({ error: "Failed to export price moves" });
  }
});

// Update inventory item
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existingItem = await prisma.inventoryItem.findUnique({
      where: { id },
      select: {
        cardId: true,
        type: true,
        priceCurrentAsk: true,
      },
    });

    if (!existingItem) {
      return res.status(404).json({ error: "Inventory item not found" });
    }

    const updates = {
      ...req.body,
      // Keep payload explicit and avoid writing undefined values.
      ...(req.body.condition === undefined
        ? {}
        : { condition: req.body.condition }),
      ...(req.body.type === undefined ? {} : { type: req.body.type }),
    };

    try {
      const item = await prisma.inventoryItem.update({
        where: { id },
        data: updates,
      });

      try {
        await maybeRecordPriceSnapshot({
          cardId: item.cardId,
          type: item.type,
          previousPrice: toFiniteNumber(existingItem.priceCurrentAsk),
          nextPriceRaw: updates.priceCurrentAsk,
        });
      } catch (snapshotError) {
        console.error(
          "[INVENTORY] Failed to record price snapshot:",
          snapshotError,
        );
      }

      return res.json(item);
    } catch (error) {
      if (hasMissingExtendedFieldError(error)) {
        const {
          condition: _condition,
          type: _type,
          ...fallbackUpdates
        } = updates;
        const fallbackItem = await prisma.inventoryItem.update({
          where: { id },
          data: fallbackUpdates,
        });

        try {
          await maybeRecordPriceSnapshot({
            cardId: fallbackItem.cardId,
            type: fallbackItem.type,
            previousPrice: toFiniteNumber(existingItem.priceCurrentAsk),
            nextPriceRaw: fallbackUpdates.priceCurrentAsk,
          });
        } catch (snapshotError) {
          console.error(
            "[INVENTORY] Failed to record fallback price snapshot:",
            snapshotError,
          );
        }

        return res.json(fallbackItem);
      }
      throw error;
    }
  } catch (error) {
    console.error("[INVENTORY] Failed to update inventory item:", error);
    res.status(500).json({ error: "Failed to update inventory item" });
  }
});

// Delete inventory item
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.inventoryItem.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error("[INVENTORY] Failed to delete inventory item:", error);
    res.status(500).json({ error: "Failed to delete inventory item" });
  }
});

export default router;
