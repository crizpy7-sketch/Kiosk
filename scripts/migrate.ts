/**
 * Minimal forward-only migration runner.
 *
 * Applies migrations/*.sql in filename order inside a transaction each, tracking
 * what ran in `schema_migrations`. No rollback: for a schema this size, a
 * corrective forward migration is clearer than a down-script nobody tests.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --reset drop and rebuild (refuses in production)
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { loadDotEnv } from "./load-env";

async function main(): Promise<void> {
  loadDotEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local first.");

  const reset = process.argv.includes("--reset");
  if (reset && process.env.NODE_ENV === "production") {
    throw new Error("Refusing to --reset with NODE_ENV=production.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    if (reset) {
      console.log("Dropping public schema…");
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const dir = join(process.cwd(), "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      process.stdout.write(`Applying ${file}… `);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log("ok");
        count += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("failed");
        throw error;
      }
    }

    console.log(count === 0 ? "Already up to date." : `Applied ${count} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
