#!/usr/bin/env node

const { Pool } = require("pg");

const SOURCE_DB = {
  user: "postgres",
  password: "password",
  host: "localhost",
  port: 5432,
  database: "pokedex",
};

const DEST_DB = {
  user: "pokevendor",
  password: "pokevendor",
  host: "localhost",
  port: 5433, // Using a different port to avoid conflict
  database: "pokevendor",
};

async function migrateCards() {
  const sourcePool = new Pool(SOURCE_DB);
  const destPool = new Pool(DEST_DB);

  try {
    console.log("Connecting to source database (pokegraph)...");
    await sourcePool.query("SELECT 1");
    console.log("✓ Connected to source database");

    console.log("Connecting to destination database (pokevendor)...");
    await destPool.query("SELECT 1");
    console.log("✓ Connected to destination database");

    console.log("\nFetching cards from pokegraph...");
    const result = await sourcePool.query(
      'SELECT id, data, "tcgPlayerId" FROM "Card"',
    );
    const cards = result.rows;
    console.log(`✓ Found ${cards.length} cards`);

    console.log("\nMigrating cards to pokevendor...");
    let count = 0;
    for (const card of cards) {
      try {
        await destPool.query(
          'INSERT INTO "Card" (id, data, "tcgPlayerId") VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = $2, "tcgPlayerId" = $3',
          [card.id, card.data, card.tcgPlayerId],
        );
        count++;
        if (count % 1000 === 0) {
          console.log(`  Progress: ${count}/${cards.length}`);
        }
      } catch (err) {
        console.error(`Error inserting card ${card.id}:`, err.message);
      }
    }

    console.log(`\n✓ Successfully migrated ${count}/${cards.length} cards`);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await destPool.end();
  }
}

migrateCards();
