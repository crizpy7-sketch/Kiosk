import { expect, test } from "@playwright/test";
import {
  acceptAndGetQr,
  consentAndOpenCamera,
  generateAndCapture,
  openAdmin,
  OWNER_STATE,
  payInDemo,
  startOrder,
} from "./helpers";

/**
 * Admin authentication, roles, and the staff recovery workflows.
 *
 * Two groups: the first runs signed OUT (it is testing the gate), the second
 * reuses the session created by auth.setup.ts.
 */

test.describe("admin is closed by default", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("14 — every admin page redirects to sign-in when signed out", async ({ page }) => {
    for (const path of ["/admin", "/admin/orders", "/admin/settings", "/admin/audit", "/admin/experiences"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login/);
    }
  });

  test("15 — rejects wrong credentials with a message that reveals nothing", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByTestId("admin-email").fill("nobody@example.com");
    await page.getByTestId("admin-password").fill("wrong-password-here");
    await page.getByTestId("admin-submit").click();

    const error = page.getByTestId("admin-login-error");
    await expect(error).toBeVisible();
    // Identical wording whether or not the account exists — no enumeration.
    await expect(error).toHaveText("Incorrect email or password.");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe("signed in as owner", () => {
  test.use({ storageState: OWNER_STATE });

  test("16 — the dashboard shows the pilot's numbers", async ({ page }) => {
    await openAdmin(page);
    await expect(page.getByTestId("admin-role")).toHaveText("owner");
    await expect(page.getByTestId("stat-revenue")).toBeVisible();
    await expect(page.getByTestId("stat-deliveries")).toBeVisible();
    await expect(page.getByTestId("stat-failed")).toBeVisible();
    await expect(page.getByTestId("stat-refunds")).toBeVisible();
    await expect(page.getByTestId("stat-ai-seconds")).toBeVisible();
    await expect(page.getByTestId("stat-kiosk")).toBeVisible();
    await expect(page.getByTestId("stat-battery")).toBeVisible();
    await expect(page.getByTestId("pilot-progress")).toContainText("/ 25 delivered");
  });

  test("17 — no admin page ever renders a credential", async ({ page }) => {
    for (const path of ["/admin", "/admin/orders", "/admin/settings", "/admin/audit", "/admin/experiences"]) {
      await page.goto(path);
      const html = await page.content();
      expect(html).not.toContain("sk_live");
      expect(html).not.toContain("sk_test");
      expect(html).not.toContain("whsec_");
      expect(html).not.toContain(process.env["APP_SECRET"] ?? "__unset__");
    }

    await page.goto("/admin/settings");
    await expect(page.getByText(/never shown here/i)).toBeVisible();
  });

  test("18 — a delivered order can have its QR regenerated", async ({ page }) => {
    await startOrder(page, "slime-star");
    await payInDemo(page);
    await consentAndOpenCamera(page);
    await generateAndCapture(page);
    await acceptAndGetQr(page);

    await page.goto("/admin/orders?filter=delivered");
    await page.getByTestId("orders-table").waitFor();
    await page.getByRole("link", { name: "Open" }).first().click();

    await page.getByTestId("action-regenerate-qr").waitFor();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("action-regenerate-qr").click();

    await expect(page.getByTestId("action-result")).toContainText(/New link created/i);
    await expect(page.getByTestId("regenerated-qr")).toBeVisible();
  });

  test("19 — staff request a refund and an owner completes it", async ({ page }) => {
    await startOrder(page, "royal-fantasy");
    await payInDemo(page);
    await consentAndOpenCamera(page);
    await generateAndCapture(page);
    await acceptAndGetQr(page);

    await page.goto("/admin/orders?filter=delivered");
    await page.getByRole("link", { name: "Open" }).first().click();

    await page.getByTestId("staff-note").fill("Customer unhappy with the result.");
    await page.getByTestId("action-request-refund").click();
    await expect(page.getByTestId("action-result")).toContainText(/Refund requested/i);

    await page.reload();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("action-complete-refund").click();
    await expect(page.getByTestId("action-result")).toContainText(/Refunded/i);

    await page.reload();
    await expect(page.getByText("refunded", { exact: false }).first()).toBeVisible();
  });

  test("20 — a paid order whose AI failed reaches Needs attention and can be retried", async ({ page }) => {
    await startOrder(page, "anime-power-up");
    await payInDemo(page);

    await page.route("**/api/ai/session", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "AI_CONNECT_FAILED", message: "unavailable" } }),
      }),
    );
    await consentAndOpenCamera(page);
    await page.getByTestId("camera-ready").click();
    await page.getByTestId("screen-error").waitFor({ timeout: 30_000 });

    const reference = ((await page.getByText(/^WF-/).textContent()) ?? "").trim();
    expect(reference).toMatch(/^WF-/);
    await page.unroute("**/api/ai/session");

    // The whole point: staff can find this customer without being told anything.
    await page.goto("/admin/orders?filter=attention");
    await expect(page.getByTestId("orders-table")).toContainText(reference);

    await page.goto(`/admin/orders?filter=all&q=${encodeURIComponent(reference)}`);
    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page.getByTestId("order-error")).toBeVisible();
    await expect(page.getByText(/paid and did not get their photo/i)).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("action-retry").click();
    await expect(page.getByTestId("action-result")).toContainText(/Re-authorized/i);
  });

  test("21 — disabling a style removes it from the kiosk immediately", async ({ page }) => {
    await page.goto("/admin/experiences");

    await page.getByTestId("toggle-royal-fantasy").click();
    await expect(page.getByTestId("toggle-royal-fantasy")).toContainText(/Disabled/i);

    await page.goto("/kiosk");
    await page.getByTestId("attract-start").click();
    await expect(page.getByTestId("style-card-royal-fantasy")).toHaveCount(0);
    await expect(page.getByTestId("style-card-slime-star")).toBeVisible();

    // Restore, so the suite leaves the kiosk as it found it.
    await page.goto("/admin/experiences");
    await page.getByTestId("toggle-royal-fantasy").click();
    await expect(page.getByTestId("toggle-royal-fantasy")).toContainText(/Active/i);
  });

  test("22 — the audit trail records sign-ins and order transitions", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByTestId("audit-table")).toContainText("admin.login_succeeded");
    await expect(page.getByTestId("audit-table")).toContainText("order.");
  });

  test("23 — signing out ends the session", async ({ page }) => {
    await openAdmin(page);
    await page.getByTestId("admin-signout").click();
    await expect(page).toHaveURL(/\/admin\/login/);

    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
