import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Points the suite at a dedicated test database and migrates it.
 *
 * A real Postgres, not a fake: the state machine's safety depends on
 * `SELECT … FOR UPDATE` and a compare-and-set UPDATE, and an in-memory stub
 * would pass those tests while proving nothing about the guarantee that matters.
 */
export default function setup(): void {
  loadEnvFile();

  const testUrl =
    process.env["TEST_DATABASE_URL"] ??
    (process.env["DATABASE_URL"] ?? "").replace(/\/[^/]+$/, "/wildframe_test");

  if (!testUrl) {
    throw new Error("Set TEST_DATABASE_URL (or DATABASE_URL) before running the test suite.");
  }

  process.env["DATABASE_URL"] = testUrl;
  // Next.js augments ProcessEnv with a readonly NODE_ENV; the cast is confined
  // to this one line rather than loosening the type everywhere.
  (process.env as Record<string, string>)["NODE_ENV"] = "test";
  process.env["DEMO_MODE"] = "true";
  process.env["APP_SECRET"] ??= "test-secret-that-is-definitely-long-enough-000000";
  process.env["APP_BASE_URL"] ??= "http://localhost:3000";
  process.env["KIOSK_ID"] ??= "kiosk-test-01";
  process.env["STORAGE_DRIVER"] = "filesystem";
  process.env["STORAGE_LOCAL_DIR"] = ".data/test-assets";

  execFileSync("npx", ["tsx", "scripts/migrate.ts", "--reset"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
  execFileSync("npx", ["tsx", "scripts/seed.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
      KIOSK_ID: process.env["KIOSK_ID"],
      SEED_OWNER_EMAIL: "owner@test.local",
      SEED_OWNER_PASSWORD: "test-owner-password-123",
    },
  });
}

function loadEnvFile(): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] ??= value;
    }
  }
}
