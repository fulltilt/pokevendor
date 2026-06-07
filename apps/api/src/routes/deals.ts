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

// Deal analytics grouped by location with optional filters (must be before /:dealId)
router.get("/analytics", async (req: Request, res: Response) => {
  try {
    const { location, dateFrom, dateTo } = req.query;

    const where: Prisma.DealWhereInput = { status: "finalized" };

    // Filter by location
    if (typeof location === "string" && location.trim()) {
      where.location = { equals: location.trim() };
    }

    // Filter by date range
    if (typeof dateFrom === "string" && dateFrom.trim()) {
      if (!where.dateFinalized) {
        where.dateFinalized = {};
      }
      where.dateFinalized = {
        ...(where.dateFinalized as any),
        gte: new Date(dateFrom),
      };
    }
    if (typeof dateTo === "string" && dateTo.trim()) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      if (!where.dateFinalized) {
        where.dateFinalized = {};
      }
      where.dateFinalized = {
        ...(where.dateFinalized as any),
        lte: endDate,
      };
    }

    const deals = await prisma.deal.findMany({
      where,
      include: { items: true },
      orderBy: { dateFinalized: "desc" },
    });

    const locationMap = new Map<
      string,
      {
        location: string;
        dealCount: number;
        totalIncoming: number;
        totalOutgoing: number;
        lastDealDate: Date | null;
      }
    >();

    for (const deal of deals) {
      const loc = deal.location || "Unspecified";
      const incomingTotal = deal.items
        .filter((i) => i.direction === "incoming")
        .reduce((s, i) => s + i.price * i.quantity, 0);
      const outgoingTotal = deal.items
        .filter((i) => i.direction === "outgoing")
        .reduce((s, i) => s + i.price * i.quantity, 0);

      const existing = locationMap.get(loc);
      if (existing) {
        existing.dealCount += 1;
        existing.totalIncoming += incomingTotal;
        existing.totalOutgoing += outgoingTotal;
        if (
          !existing.lastDealDate ||
          (deal.dateFinalized && deal.dateFinalized > existing.lastDealDate)
        ) {
          existing.lastDealDate = deal.dateFinalized;
        }
      } else {
        locationMap.set(loc, {
          location: loc,
          dealCount: 1,
          totalIncoming: incomingTotal,
          totalOutgoing: outgoingTotal,
          lastDealDate: deal.dateFinalized,
        });
      }
    }

    const analytics = Array.from(locationMap.values())
      .map((loc) => ({
        ...loc,
        totalNetCash: loc.totalOutgoing - loc.totalIncoming,
        avgNetCash: (loc.totalOutgoing - loc.totalIncoming) / loc.dealCount,
      }))
      .sort(
        (a, b) =>
          (b.lastDealDate?.getTime() ?? 0) - (a.lastDealDate?.getTime() ?? 0),
      );

    res.json({ analytics, totalDeals: deals.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Deal analytics grouped by time (month/year) with optional filters
router.get("/analytics/time", async (req: Request, res: Response) => {
  try {
    const { location, dateFrom, dateTo, groupBy } = req.query;
    const groupByVal = (typeof groupBy === "string" ? groupBy : "month") as
      | "month"
      | "year";

    const where: Prisma.DealWhereInput = { status: "finalized" };

    // Filter by location
    if (typeof location === "string" && location.trim()) {
      where.location = { equals: location.trim() };
    }

    // Filter by date range
    if (typeof dateFrom === "string" && dateFrom.trim()) {
      if (!where.dateFinalized) {
        where.dateFinalized = {};
      }
      where.dateFinalized = {
        ...(where.dateFinalized as any),
        gte: new Date(dateFrom),
      };
    }
    if (typeof dateTo === "string" && dateTo.trim()) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      if (!where.dateFinalized) {
        where.dateFinalized = {};
      }
      where.dateFinalized = {
        ...(where.dateFinalized as any),
        lte: endDate,
      };
    }

    const deals = await prisma.deal.findMany({
      where,
      include: { items: true },
      orderBy: { dateFinalized: "asc" },
    });

    const timeMap = new Map<
      string,
      {
        period: string;
        year: number;
        month?: number;
        dealCount: number;
        totalIncoming: number;
        totalOutgoing: number;
      }
    >();

    for (const deal of deals) {
      if (!deal.dateFinalized) continue;

      const date = deal.dateFinalized;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      const periodKey =
        groupByVal === "year"
          ? `${year}`
          : `${year}-${String(month).padStart(2, "0")}`;
      const period =
        groupByVal === "year"
          ? `${year}`
          : `${year}-${String(month).padStart(2, "0")}`;

      const incomingTotal = deal.items
        .filter((i) => i.direction === "incoming")
        .reduce((s, i) => s + i.price * i.quantity, 0);
      const outgoingTotal = deal.items
        .filter((i) => i.direction === "outgoing")
        .reduce((s, i) => s + i.price * i.quantity, 0);

      const existing = timeMap.get(periodKey);
      if (existing) {
        existing.dealCount += 1;
        existing.totalIncoming += incomingTotal;
        existing.totalOutgoing += outgoingTotal;
      } else {
        timeMap.set(periodKey, {
          period,
          year,
          ...(groupByVal === "month" && { month }),
          dealCount: 1,
          totalIncoming: incomingTotal,
          totalOutgoing: outgoingTotal,
        });
      }
    }

    const analytics = Array.from(timeMap.values())
      .map((entry) => ({
        ...entry,
        totalNetCash: entry.totalOutgoing - entry.totalIncoming,
        avgNetCash:
          (entry.totalOutgoing - entry.totalIncoming) / entry.dealCount,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    res.json({ analytics, totalDeals: deals.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch time analytics" });
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

// List deals (filterable, searchable, sortable)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, q, sortBy, limit, offset } = req.query;
    const pageLimit = Math.min(Number(limit ?? 50), 100);
    const pageOffset = Math.max(Number(offset ?? 0), 0);
    const search = typeof q === "string" && q.trim() ? q.trim() : null;

    const where: Prisma.DealWhereInput = {};
    if (typeof status === "string") {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { location: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    let orderBy: Prisma.DealOrderByWithRelationInput;
    if (sortBy === "dateAsc") {
      orderBy = { dateFinalized: "asc" };
    } else if (sortBy === "location") {
      orderBy = { location: "asc" };
    } else {
      orderBy = { dateFinalized: "desc" };
    }

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          items: {
            include: {
              card: { select: { id: true, data: true, tcgPlayerId: true } },
            },
          },
        },
        take: pageLimit,
        skip: pageOffset,
        orderBy,
      }),
      prisma.deal.count({ where }),
    ]);

    const formatted = deals.map((deal) => {
      const incoming = deal.items.filter((i) => i.direction === "incoming");
      const outgoing = deal.items.filter((i) => i.direction === "outgoing");
      const incomingTotal = incoming.reduce(
        (s, i) => s + i.price * i.quantity,
        0,
      );
      const outgoingTotal = outgoing.reduce(
        (s, i) => s + i.price * i.quantity,
        0,
      );
      return {
        ...deal,
        incoming,
        outgoing,
        incomingTotal,
        outgoingTotal,
        netCash: outgoingTotal - incomingTotal,
      };
    });

    res.json({ deals: formatted, total });
  } catch {
    res.status(500).json({ error: "Failed to fetch deals" });
  }
});

// Update deal (location, notes)
router.patch("/:dealId", async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const { location, notes } = req.body;

    const deal = await prisma.deal.update({
      where: { id: dealId },
      data: {
        ...(location !== undefined && { location }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json({ success: true, deal });
  } catch {
    res.status(500).json({ error: "Failed to update deal" });
  }
});

// Delete deal (cascade deletes DealItems via FK)
router.delete("/:dealId", async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;

    await prisma.deal.delete({
      where: { id: dealId },
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete deal" });
  }
});

export default router;
