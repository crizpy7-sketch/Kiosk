import { test as setup, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { OWNER_STATE } from "./helpers";

/**
 * Signs in once and saves the session for the admin specs to reuse.
 *
 * Not just a speed optimisation: /api/admin/login is rate limited to 8 attempts
 * per five minutes per IP, deliberately, and a suite that signs in for every
 * test would trip its own brute-force protection. Signing in once per run also
 * matches how the dashboard is actually used — a staff member signs in at the
 * start of a shift, not before each action.
 */
setup("authenticate as owner", async ({ page }) => {
  await mkdir(dirname(OWNER_STATE), { recursive: true });

  await page.goto("/admin/login");
  await page.getByTestId("admin-email").fill(process.env["E2E_OWNER_EMAIL"] ?? "owner@wildframe.local");
  await page
    .getByTestId("admin-password")
    .fill(process.env["E2E_OWNER_PASSWORD"] ?? "wildframe-dev-owner-2026");
  await page.getByTestId("admin-submit").click();

  await page.waitForURL(/\/admin$/, { timeout: 30_000 });
  await expect(page.getByTestId("admin-role")).toHaveText("owner");

  await page.context().storageState({ path: OWNER_STATE });
});
