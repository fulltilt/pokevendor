import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

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
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const where: Record<string, string> = {};
    if (storageType && typeof storageType === "string") {
      where.storageType = storageType;
    }

    // Aggregate total value over ALL matching items (not just current page)
    const storageFilter =
      storageType && typeof storageType === "string" ? storageType : null;

    const valueAggQuery = storageFilter
      ? prisma.$queryRaw<[{ total: number }]>`
          SELECT COALESCE(SUM(
            COALESCE("priceCurrentAsk", "pricePurchasedAt") * quantity
          ), 0)::float AS total
          FROM "InventoryItem"
          WHERE "storageType" = ${storageFilter}
        `
      : prisma.$queryRaw<[{ total: number }]>`
          SELECT COALESCE(SUM(
            COALESCE("priceCurrentAsk", "pricePurchasedAt") * quantity
          ), 0)::float AS total
          FROM "InventoryItem"
        `;

    const [items, total, valueAgg] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: { card: { include: { prices: true } } },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.inventoryItem.count({ where }),
      valueAggQuery,
    ]);

    const totalValue = Number(valueAgg[0]?.total ?? 0);

    res.json({
      items,
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

// Update inventory item
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
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

        return res.json(fallbackItem);
      }
      throw error;
    }
  } catch (error) {
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
    res.status(500).json({ error: "Failed to delete inventory item" });
  }
});

export default router;
