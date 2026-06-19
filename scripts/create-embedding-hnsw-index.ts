#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve } from "node:path";

if (!process.env.DATABASE_URL) {
  config({ path: resolve(process.cwd(), "apps/api/.env") });
}

const prisma = new PrismaClient();

const parseArgs = (): { source: string } => {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--source");
  const source = idx >= 0 ? (args[idx + 1] ?? "vision-v1") : "vision-v1";
  return { source };
};

const main = async () => {
  const { source } = parseArgs();

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardEmbedding_source_idx"
    ON "CardEmbedding"(source)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardEmbedding_embedding_hnsw_idx"
    ON "CardEmbedding" USING hnsw (embedding vector_cosine_ops)
  `);

  await prisma.$executeRawUnsafe(`
    ANALYZE "CardEmbedding"
  `);

  const count = await prisma.$queryRawUnsafe<{ total: number }[]>(
    'SELECT COUNT(*)::int AS total FROM "CardEmbedding" WHERE source = $1',
    source,
  );

  console.log(
    `HNSW index ready. rows for source=${source}: ${count[0]?.total ?? 0}`,
  );
};

main()
  .catch((error) => {
    console.error("Failed to create embedding index:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
