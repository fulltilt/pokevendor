import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => unknown) => {
    return callback(mockTx);
  }),
  dealItem: {
    create: vi.fn(),
  },
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

describe("POST /api/deals/:dealId/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores missing price as zero", async () => {
    mockPrisma.dealItem.create.mockResolvedValue({
      id: "item-1",
      dealId: "deal-1",
      cardId: "card-1",
      direction: "incoming",
      quantity: 1,
      price: 0,
      itemType: "card",
      notes: null,
    });

    const app = await buildApp();
    const response = await request(app).post("/api/deals/deal-1/items").send({
      cardId: "card-1",
      direction: "incoming",
      quantity: 1,
      itemType: "card",
    });

    expect(response.status).toBe(200);
    expect(mockPrisma.dealItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dealId: "deal-1",
        cardId: "card-1",
        direction: "incoming",
        quantity: 1,
        price: 0,
      }),
    });
  });

  it("stores blank-string price as zero", async () => {
    mockPrisma.dealItem.create.mockResolvedValue({
      id: "item-2",
      dealId: "deal-1",
      cardId: "card-2",
      direction: "incoming",
      quantity: 1,
      price: 0,
      itemType: "card",
      notes: null,
    });

    const app = await buildApp();
    const response = await request(app).post("/api/deals/deal-1/items").send({
      cardId: "card-2",
      direction: "incoming",
      quantity: 1,
      price: "",
      itemType: "card",
    });

    expect(response.status).toBe(200);
    expect(mockPrisma.dealItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        price: 0,
      }),
    });
  });

  it("returns 400 when direction is missing", async () => {
    const app = await buildApp();
    const response = await request(app).post("/api/deals/deal-1/items").send({
      cardId: "card-1",
      quantity: 1,
      price: 3.5,
      itemType: "card",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Missing required field: direction",
    });
    expect(mockPrisma.dealItem.create).not.toHaveBeenCalled();
  });
});
