import { Router, type Request, type Response } from "express";
import { PrismaClient, type Prisma } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

const DEAL_NOT_FOUND = "DEAL_NOT_FOUND";
const DEAL_ALREADY_FINALIZED = "DEAL_ALREADY_FINALIZED";
const INSUFFICIENT_INVENTORY_PREFIX = "INSUFFICIENT_INVENTORY:";

const syncIncomingItemsToInventory = async (
  tx: Prisma.TransactionClient,
  incomingItems: Array<{
    cardId: string | null;
    quantity: number;
    price: number;
    itemType: string;
  }>,
  location: string | null,
) => {
  for (const item of incomingItems) {
    if (!item.cardId) {
      continue;
    }

    await tx.inventoryItem.create({
      data: {
        cardId: item.cardId,
        quantity: item.quantity,
        type: item.itemType || "card",
        condition: item.itemType === "card" ? "NM" : null,
        storageType: "not_in_case",
        pricePurchasedAt: item.price,
        purchasedAt: new Date(),
        purchasedFrom: location || "Deal",
        priceCurrentAsk: item.price,
      },
    });
  }
};

const applyOutgoingInventoryAdjustments = async (
  tx: Prisma.TransactionClient,
  outgoingItems: Array<{
    cardId: string | null;
    quantity: number;
  }>,
) => {
  for (const item of outgoingItems) {
    if (!item.cardId) {
      continue;
    }

    let remainingToRemove = item.quantity;
    const inventoryRows = await tx.inventoryItem.findMany({
      where: { cardId: item.cardId },
      orderBy: { createdAt: "asc" },
    });

    const totalAvailable = inventoryRows.reduce(
      (sum, row) => sum + row.quantity,
      0,
    );

    if (totalAvailable < remainingToRemove) {
      throw new Error(`${INSUFFICIENT_INVENTORY_PREFIX}${item.cardId}`);
    }

    for (const row of inventoryRows) {
      if (remainingToRemove <= 0) {
        break;
      }

      const removeFromRow = Math.min(row.quantity, remainingToRemove);
      if (removeFromRow === row.quantity) {
        await tx.inventoryItem.delete({ where: { id: row.id } });
      } else {
        await tx.inventoryItem.update({
          where: { id: row.id },
          data: { quantity: row.quantity - removeFromRow },
        });
      }

      remainingToRemove -= removeFromRow;
    }
  }
};

const finalizeDealWithInventorySync = async (dealId: string) => {
  return prisma.$transaction(async (tx) => {
    const existingDeal = await tx.deal.findUnique({
      where: { id: dealId },
      include: {
        items: { include: { card: true } },
      },
    });

    if (!existingDeal) {
      throw new Error(DEAL_NOT_FOUND);
    }

    if (existingDeal.status === "finalized") {
      throw new Error(DEAL_ALREADY_FINALIZED);
    }

    const incomingItems = existingDeal.items.filter(
      (item) => item.direction === "incoming",
    );
    const outgoingItems = existingDeal.items.filter(
      (item) => item.direction === "outgoing",
    );

    await syncIncomingItemsToInventory(
      tx,
      incomingItems,
      existingDeal.location,
    );
    await applyOutgoingInventoryAdjustments(tx, outgoingItems);

    return tx.deal.update({
      where: { id: dealId },
      data: {
        status: "finalized",
        dateFinalized: new Date(),
      },
      include: {
        items: { include: { card: true } },
      },
    });
  });
};

// Create deal
router.post("/", async (req: Request, res: Response) => {
  try {
    const { location, notes } = req.body;

    const deal = await prisma.deal.create({
      data: {
        location,
        notes,
        status: "pending",
      },
    });

    res.json(deal);
  } catch {
    res.status(500).json({ error: "Failed to create deal" });
  }
});

// Add item to deal
router.post("/:dealId/items", async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const {
      cardId,
      direction,
      quantity = 1,
      price,
      itemType = "card",
      notes,
    } = req.body;

    const isMissingPrice =
      price === undefined || price === null || price === "";

    if (!direction || isMissingPrice) {
      return res.status(400).json({
        error: "Missing required fields: direction, price",
      });
    }

    if (!["incoming", "outgoing"].includes(direction)) {
      return res
        .status(400)
        .json({ error: 'Direction must be "incoming" or "outgoing"' });
    }

    const item = await prisma.dealItem.create({
      data: {
        dealId,
        cardId: itemType === "card" ? cardId : null,
        direction,
        quantity,
        price,
        itemType,
        notes: notes || null,
      },
    });

    res.json(item);
  } catch {
    res.status(500).json({ error: "Failed to add deal item" });
  }
});

// Get deal details
router.get("/:dealId", async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        items: { include: { card: true } },
      },
    });

    if (!deal) {
      return res.status(404).json({ error: "Deal not found" });
    }

    const incoming = deal.items.filter((item) => item.direction === "incoming");
    const outgoing = deal.items.filter((item) => item.direction === "outgoing");

    // Calculate totals
    const incomingTotal = incoming.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const outgoingTotal = outgoing.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const netCash = incomingTotal - outgoingTotal;

    res.json({
      deal: {
        ...deal,
        incoming,
        outgoing,
      },
      incomingTotal,
      outgoingTotal,
      netCash,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch deal" });
  }
});

// Update deal item (quantity, price, direction)
router.patch("/items/:itemId", async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const { quantity, price, direction, notes } = req.body;

    if (
      direction !== undefined &&
      !["incoming", "outgoing"].includes(direction)
    ) {
      return res
        .status(400)
        .json({ error: 'Direction must be "incoming" or "outgoing"' });
    }

    const item = await prisma.dealItem.update({
      where: { id: itemId },
      data: {
        ...(quantity !== undefined && { quantity }),
        ...(price !== undefined && { price }),
        ...(direction !== undefined && { direction }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(item);
  } catch {
    res.status(500).json({ error: "Failed to update deal item" });
  }
});

// Delete deal item
router.delete("/items/:itemId", async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    await prisma.dealItem.delete({ where: { id: itemId } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete deal item" });
  }
});

// Finalize deal
router.post("/:dealId/finalize", async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const deal = await finalizeDealWithInventorySync(dealId);

    const incoming = deal.items.filter((item) => item.direction === "incoming");
    const outgoing = deal.items.filter((item) => item.direction === "outgoing");

    res.json({
      ...deal,
      incoming,
      outgoing,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === DEAL_NOT_FOUND) {
        return res.status(404).json({ error: "Deal not found" });
      }
      if (error.message === DEAL_ALREADY_FINALIZED) {
        return res.status(400).json({ error: "Deal already finalized" });
      }
      if (error.message.startsWith(INSUFFICIENT_INVENTORY_PREFIX)) {
        const cardId = error.message.split(":")[1] || "unknown";
        return res.status(400).json({
          error: `Insufficient inventory to finalize outgoing card ${cardId}`,
        });
      }
    }
    res.status(500).json({ error: "Failed to finalize deal" });
  }
});

// List deals
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status = "pending", limit = 20, offset = 0 } = req.query;

    const deals = await prisma.deal.findMany({
      where: { status: typeof status === "string" ? status : "pending" },
      include: {
        items: true,
      },
      take: Number(limit),
      skip: Number(offset),
      orderBy: { createdAt: "desc" },
    });

    const formatted = deals.map((deal) => ({
      ...deal,
      incoming: deal.items.filter((item) => item.direction === "incoming"),
      outgoing: deal.items.filter((item) => item.direction === "outgoing"),
    }));

    res.json(formatted);
  } catch {
    res.status(500).json({ error: "Failed to fetch deals" });
  }
});

export default router;
