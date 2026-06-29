import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  deal: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  inventoryItem: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => unknown) => {
    return callback(mockTx);
  }),
};

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: vi.fn(() => mockPrisma),
  };
});

const buildApp = async () => {
  vi.resetModules();
  const { default: dealsRouter } = await import("./deals.ts");
  const app = express();
  app.use(express.json());
  app.use("/api/deals", dealsRouter);
  return app;
};

describe("DELETE /api/deals/:dealId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rolls back finalized deal inventory changes before deleting", async () => {
    mockTx.deal.findUnique.mockResolvedValue({
      id: "deal-1",
      location: "Card Show",
      status: "finalized",
      items: [
        {
          cardId: "card-incoming",
          quantity: 2,
          price: 12,
          itemType: "card",
          direction: "incoming",
        },
        {
          cardId: "card-outgoing",
          quantity: 1,
          price: 25,
          itemType: "card",
          direction: "outgoing",
        },
      ],
    });

    mockTx.inventoryItem.create.mockResolvedValue({ id: "created-row" });
    mockTx.inventoryItem.findMany.mockResolvedValue([
      {
        id: "incoming-row",
        quantity: 2,
        createdAt: new Date(),
      },
    ]);
    mockTx.inventoryItem.delete.mockResolvedValue({ id: "incoming-row" });
    mockTx.deal.delete.mockResolvedValue({ id: "deal-1" });

    const app = await buildApp();
    const response = await request(app).delete("/api/deals/deal-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    expect(mockTx.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cardId: "card-outgoing",
        quantity: 1,
      }),
    });

    expect(mockTx.inventoryItem.findMany).toHaveBeenCalledWith({
      where: { cardId: "card-incoming" },
      orderBy: { createdAt: "desc" },
    });

    expect(mockTx.inventoryItem.delete).toHaveBeenCalledWith({
      where: { id: "incoming-row" },
    });

    expect(mockTx.deal.delete).toHaveBeenCalledWith({
      where: { id: "deal-1" },
    });
  });

  it("deletes pending deals without inventory rollback", async () => {
    mockTx.deal.findUnique.mockResolvedValue({
      id: "deal-2",
      location: null,
      status: "pending",
      items: [
        {
          cardId: "card-pending",
          quantity: 1,
          price: 10,
          itemType: "card",
          direction: "incoming",
        },
      ],
    });

    mockTx.deal.delete.mockResolvedValue({ id: "deal-2" });

    const app = await buildApp();
    const response = await request(app).delete("/api/deals/deal-2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    expect(mockTx.inventoryItem.create).not.toHaveBeenCalled();
    expect(mockTx.inventoryItem.findMany).not.toHaveBeenCalled();
    expect(mockTx.inventoryItem.update).not.toHaveBeenCalled();
    expect(mockTx.inventoryItem.delete).not.toHaveBeenCalled();
  });

  it("returns 400 when finalized deal rollback cannot remove incoming quantity", async () => {
    mockTx.deal.findUnique.mockResolvedValue({
      id: "deal-3",
      location: "Show",
      status: "finalized",
      items: [
        {
          cardId: "card-incoming",
          quantity: 3,
          price: 15,
          itemType: "card",
          direction: "incoming",
        },
      ],
    });

    mockTx.inventoryItem.findMany.mockResolvedValue([
      {
        id: "row-1",
        quantity: 1,
        createdAt: new Date(),
      },
    ]);

    const app = await buildApp();
    const response = await request(app).delete("/api/deals/deal-3");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(
      "Cannot delete finalized deal because inventory for card card-incoming has changed since finalization",
    );
    expect(mockTx.deal.delete).not.toHaveBeenCalled();
  });

  it("updates and deletes different inventory rows when rollback spans multiple rows", async () => {
    mockTx.deal.findUnique.mockResolvedValue({
      id: "deal-4",
      location: "Show",
      status: "finalized",
      items: [
        {
          cardId: "card-mixed",
          quantity: 3,
          price: 20,
          itemType: "card",
          direction: "incoming",
        },
      ],
    });

    mockTx.inventoryItem.findMany.mockResolvedValue([
      {
        id: "newer-row",
        quantity: 2,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        id: "older-row",
        quantity: 2,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    mockTx.inventoryItem.delete.mockResolvedValue({ id: "newer-row" });
    mockTx.inventoryItem.update.mockResolvedValue({
      id: "older-row",
      quantity: 1,
    });
    mockTx.deal.delete.mockResolvedValue({ id: "deal-4" });

    const app = await buildApp();
    const response = await request(app).delete("/api/deals/deal-4");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    expect(mockTx.inventoryItem.delete).toHaveBeenCalledWith({
      where: { id: "newer-row" },
    });

    expect(mockTx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: "older-row" },
      data: { quantity: 1 },
    });

    expect(mockTx.deal.delete).toHaveBeenCalledWith({
      where: { id: "deal-4" },
    });
  });
});
