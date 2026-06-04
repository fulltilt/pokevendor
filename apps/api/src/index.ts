import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
import cardRoutes from "./routes/cards.js";
import inventoryRoutes from "./routes/inventory.js";
import dealRoutes from "./routes/deals.js";
import locationRoutes from "./routes/locations.js";

app.use("/api/cards", cardRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/deals", dealRoutes);
app.use("/api/locations", locationRoutes);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
