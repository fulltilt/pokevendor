import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// List all locations
router.get("/", async (req: Request, res: Response) => {
  try {
    const locations = await prisma.dealLocation.findMany({
      orderBy: { name: "asc" },
    });

    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

// Create new location
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const location = await prisma.dealLocation.create({
      data: { name },
    });

    res.json(location);
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Location already exists" });
    }
    res.status(500).json({ error: "Failed to create location" });
  }
});

export default router;
