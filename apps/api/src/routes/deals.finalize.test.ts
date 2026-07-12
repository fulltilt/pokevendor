import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  deal: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  dealItem: {
    update: vi.fn(),
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

describe("POST /api/deals/:dealId/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("discounts incoming item prices before finalizing the deal", async () => {
    const discountedItem = {
      id: "incoming-item-1",
      dealId: "deal-1",
      cardId: "card-1",
      direction: "incoming",
      quantity: 1,
      price: 67.2,
      itemType: "card",
      notes: null,
      card: null,
    };

    mockTx.deal.findUnique.mockResolvedValue({
      id: "deal-1",
      location: "Card Show",
      status: "pending",
      items: [
        {
          id: "incoming-item-1",
          dealId: "deal-1",
          cardId: "card-1",
          direction: "incoming",
          quantity: 1,
          price: 84,
          itemType: "card",
          notes: null,
          card: null,
        },
      ],
    });

    mockTx.dealItem.update.mockResolvedValue(discountedItem);
    mockTx.deal.update.mockResolvedValue({
      id: "deal-1",
      location: "Card Show",
      status: "finalized",
      dateFinalized: new Date(),
      items: [discountedItem],
    });

    const app = await buildApp();
    const response = await request(app)
      .post("/api/deals/deal-1/finalize")
      .send({ outgoingTradePercentage: 80 });

    expect(response.status).toBe(200);
    expect(mockTx.dealItem.update).toHaveBeenCalledWith({
      where: { id: "incoming-item-1" },
      data: { price: 67.2 },
    });
    expect(response.body.incoming[0].price).toBe(67.2);
  });
});