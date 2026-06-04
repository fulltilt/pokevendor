const https = require("https");

// Helper function to execute PostgreSQL commands
function execPsql(host, port, user, password, database, sql) {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process");
    const env = { ...process.env, PGPASSWORD: password };
    const proc = spawn(
      "docker",
      [
        "exec",
        "-e",
        `PGPASSWORD=${password}`,
        `${database}-db-1`,
        "psql",
        "-U",
        user,
        "-d",
        database,
        "-c",
        sql,
      ],
      { env },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });
    proc.stderr.on("data", (data) => {
      stderr += data;
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });
  });
}

async function migrateCards() {
  try {
    console.log("Starting card migration...\n");

    // Extract raw data from pokegraph using COPY command
    console.log("Exporting cards from pokegraph...");
    const { spawn } = require("child_process");

    const dumpProc = spawn("docker", [
      "exec",
      "pokegraph-db-1",
      "psql",
      "-U",
      "postgres",
      "-d",
      "pokedex",
      "-c",
      'COPY "Card" (id, data, "tcgPlayerId") TO STDOUT',
    ]);

    let lines = [];
    dumpProc.stdout.on("data", (data) => {
      lines.push(data.toString());
    });

    dumpProc.on("close", async (code) => {
      if (code !== 0) {
        console.error("Export failed");
        process.exit(1);
      }

      const rawData = lines.join("");
      const rows = rawData
        .trim()
        .split("\n")
        .filter((l) => l.trim());

      console.log(`✓ Exported ${rows.length} cards`);
      console.log("Importing to pokevendor...");

      // Build INSERT statement
      let insertSql = 'INSERT INTO "Card" (id, data, "tcgPlayerId") VALUES ';
      const values = rows
        .map((row) => {
          const parts = row.split("\t");
          const id = parts[0];
          const data = parts[1].replace(/'/g, "''");
          const tcgId =
            parts[2] === "\\N" ? "NULL" : `'${parts[2].replace(/'/g, "''")}'`;
          return `('${id.replace(/'/g, "''")}', '${data}'::jsonb, ${tcgId})`;
        })
        .join(",\n");

      insertSql += values + " ON CONFLICT (id) DO NOTHING;";

      // Write to temp file and restore
      const fs = require("fs");
      fs.writeFileSync("/tmp/migrate.sql", insertSql);

      const restoreProc = spawn("docker", [
        "exec",
        "-i",
        "pokevendor-db-1",
        "psql",
        "-U",
        "pokevendor",
        "-d",
        "pokevendor",
      ]);
      restoreProc.stdin.write(insertSql);
      restoreProc.stdin.end();

      restoreProc.on("close", async (code) => {
        if (code === 0) {
          console.log(`✓ Successfully imported ${rows.length} cards`);
        } else {
          console.error("Import failed");
        }
      });
    });
  } catch (err) {
    console.error("Migration error:", err.message);
    process.exit(1);
  }
}

migrateCards();
