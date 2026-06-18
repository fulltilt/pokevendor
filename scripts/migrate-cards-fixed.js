#!/usr/bin/env node
/**
 * Migrate Card table from pokegraph to pokevendor
 *
 * Usage:
 *   node scripts/migrate-cards-fixed.js
 *   SOURCE_DB=pokedex SOURCE_PORT=5432 DEST_DB=pokevendor DEST_PORT=5433 node scripts/migrate-cards-fixed.js
 *   node scripts/migrate-cards-fixed.js --dry-run
 */

const pg = require("pg");

const config = {
  source: {
    user: process.env.SOURCE_USER || "postgres",
    password: process.env.SOURCE_PASSWORD || "password",
    host: process.env.SOURCE_HOST || "localhost",
    port: parseInt(process.env.SOURCE_PORT || "5432"),
    database: process.env.SOURCE_DB || "pokedex",
  },
  dest: {
    user: process.env.DEST_USER || "postgres",
    password: process.env.DEST_PASSWORD || "password",
    host: process.env.DEST_HOST || "localhost",
    port: parseInt(process.env.DEST_PORT || "5433"),
    database: process.env.DEST_DB || "pokevendor",
  },
  dryRun: process.argv.includes("--dry-run"),
};

async function migrate() {
  const sourceClient = new pg.Client(config.source);
  const destClient = new pg.Client(config.dest);

  try {
    console.log("🔗 Connecting to source (pokegraph)...");
    console.log(
      `   ${config.source.host}:${config.source.port}/${config.source.database}`,
    );
    await sourceClient.connect();

    console.log("🔗 Connecting to destination (pokevendor)...");
    console.log(
      `   ${config.dest.host}:${config.dest.port}/${config.dest.database}`,
    );
    await destClient.connect();

    console.log("\n📋 Fetching cards from source...");
    const result = await sourceClient.query('SELECT * FROM "Card" ORDER BY id');
    const cards = result.rows;
    console.log(`   Found ${cards.length} cards`);

    if (cards.length === 0) {
      console.log("⚠️  No cards to migrate");
      return;
    }

    if (config.dryRun) {
      console.log("\n[DRY RUN] Would insert the following:");
      cards.slice(0, 3).forEach((card, i) => {
        console.log(`  ${i + 1}. ${card.id} - ${card.name || "unknown"}`);
      });
      if (cards.length > 3) {
        console.log(`  ... and ${cards.length - 3} more`);
      }
      return;
    }

    console.log("\n📝 Migrating cards to destination...");
    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      try {
        // Extract columns and values, handling all field types
        const columns = Object.keys(card)
          .map((k) => `"${k}"`)
          .join(", ");
        const values = Object.values(card).map((v, idx) => {
          // Handle NULL, JSON, and other types
          if (v === null) return "NULL";
          if (typeof v === "object")
            return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
          if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
          return v;
        });

        const placeholders = Object.keys(card)
          .map((_, idx) => `$${idx + 1}`)
          .join(", ");
        const updateCols = Object.keys(card)
          .filter((k) => k !== "id")
          .map((k) => `"${k}" = EXCLUDED."${k}"`)
          .join(", ");

        const query = `
          INSERT INTO "Card" (${columns})
          VALUES (${placeholders})
          ON CONFLICT ("id") DO UPDATE SET ${updateCols}
        `;

        await destClient.query(query, Object.values(card));

        if (i % 100 === 0 && i > 0) {
          console.log(`   ✓ Processed ${i}/${cards.length}`);
        }
        inserted++;
      } catch (err) {
        console.error(`   ✗ Failed to migrate card ${card.id}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   Inserted/Updated: ${inserted}`);
    console.log(`   Failed: ${failed}`);
  } catch (err) {
    console.error("\n❌ Migration error:", err.message);
    console.error("\nTroubleshooting:");
    console.error(
      "  1. Ensure pokegraph is running: docker compose -f pokegraph/docker-compose.yml up",
    );
    console.error("  2. Ensure pokevendor is running: docker compose up");
    console.error("  3. Check environment variables:");
    console.error(`     SOURCE_DB=${process.env.SOURCE_DB || "pokedex"}`);
    console.error(`     SOURCE_PORT=${process.env.SOURCE_PORT || "5432"}`);
    console.error(`     DEST_DB=${process.env.DEST_DB || "pokevendor"}`);
    console.error(`     DEST_PORT=${process.env.DEST_PORT || "5433"}`);
    process.exit(1);
  } finally {
    await sourceClient.end();
    await destClient.end();
  }
}

// Check if pg is installed
let pgInstalled = true;
try {
  require.resolve("pg");
} catch (err) {
  pgInstalled = false;
}

if (!pgInstalled) {
  console.error('❌ The "pg" package is required but not installed.');
  console.error("\nInstall it with:");
  console.error("  npm install pg");
  process.exit(1);
}

migrate();
