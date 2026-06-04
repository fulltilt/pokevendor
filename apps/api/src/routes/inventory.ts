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
    res.status(500).json({ error: "Failed to add inventory item" });
  }
});

// List inventory with filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { storageType, limit = 20, offset = 0 } = req.query;

    const where: any = {};
    if (storageType && typeof storageType === "string") {
      where.storageType = storageType;
    }

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: { card: { include: { prices: true } } },
        take: Number(limit),
        skip: Number(offset),
        orderBy: { createdAt: "desc" },
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    // Calculate total inventory value
    const totalValue = items.reduce((sum, item) => {
      return (
        sum + (item.priceCurrentAsk || item.pricePurchasedAt) * item.quantity
      );
    }, 0);

    res.json({
      items,
      total,
      totalValue,
      limit,
      offset,
    });
  } catch (error) {
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
