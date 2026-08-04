/**
 * Seeds the kiosk row, the experience switches, and the first owner account.
 * Idempotent — safe to re-run.
 *
 * The owner password comes from SEED_OWNER_PASSWORD, or is generated and
 * printed once. There is no default password: a kiosk that ships with
 * "admin/admin" is a kiosk whose sales dashboard belongs to whoever guesses first.
 */
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { loadDotEnv } from "./load-env";
import { EXPERIENCES } from "../src/lib/config/experiences";
import { hashPassword } from "../src/lib/auth/passwords";

async function main(): Promise<void> {
  loadDotEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

  const kioskId = process.env.KIOSK_ID ?? "kiosk-shia-baby-01";
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@wildframe.local";

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `INSERT INTO kiosks (id, name, location_label, configured_language, daily_ai_limit_seconds)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, location_label = EXCLUDED.location_label`,
      [kioskId, "Wild Frame AI — Shia Baby", "Beside Shia Baby Boutique", process.env.DEFAULT_LANGUAGE ?? "en", 3600],
    );
    console.log(`Kiosk ${kioskId} ready.`);

    for (const experience of EXPERIENCES) {
      await client.query(
        `INSERT INTO experiences (id, slug, active, featured, price_cents, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug`,
        [
          experience.id,
          experience.slug,
          experience.active,
          experience.featured,
          experience.priceCents,
          experience.sortOrder,
        ],
      );
    }
    console.log(`${EXPERIENCES.length} experiences ready.`);

    const existing = await client.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [ownerEmail]);
    if (existing.rows.length > 0) {
      console.log(`Owner ${ownerEmail} already exists — password unchanged.`);
    } else {
      const generated = !process.env.SEED_OWNER_PASSWORD;
      const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(12).toString("base64url");
      const hash = await hashPassword(password);
      await client.query(`INSERT INTO users (email, password_hash, role) VALUES (lower($1), $2, 'owner')`, [
        ownerEmail,
        hash,
      ]);
      console.log(`\nOwner account created: ${ownerEmail}`);
      if (generated) {
        console.log(`Generated password (shown once — save it now): ${password}\n`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
