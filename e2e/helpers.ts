/** Where auth.setup.ts stores the signed-in owner session. */
export const OWNER_STATE = ".auth/owner.json";

import type { Page } from "@playwright/test";

/** Shared journey steps, so each spec reads as the scenario it is testing. */

export async function startOrder(page: Page, styleSlug: string): Promise<void> {
  await page.goto("/kiosk");
  await page.getByTestId("screen-attract").waitFor();
  await page.getByTestId("attract-start").click();
  await page.getByTestId(`style-card-${styleSlug}`).click();
  await page.getByTestId("style-continue").click();
  await page.getByTestId("screen-purchase").waitFor();
}

export async function payInDemo(page: Page): Promise<void> {
  await page.getByTestId("purchase-pay").click();
  await page.waitForURL(/\/demo\/checkout/);
  await page.getByTestId("demo-pay").click();
  await page.getByTestId("screen-consent").waitFor({ timeout: 45_000 });
}

export async function consentAndOpenCamera(page: Page): Promise<void> {
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("screen-camera").waitFor();
  await page.getByTestId("camera-ready").waitFor();
  // The button enables once getUserMedia resolves.
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="camera-ready"]')?.disabled,
    { timeout: 20_000 },
  );
}

/** Runs generation to the reveal screen. */
export async function generateAndCapture(page: Page): Promise<void> {
  await page.getByTestId("camera-ready").click();
  await page.getByTestId("screen-generating").waitFor();
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="generating-capture"]')?.disabled,
    { timeout: 45_000 },
  );
  await page.getByTestId("generating-capture").click();
  await page.getByTestId("screen-reveal").waitFor({ timeout: 30_000 });
}

export async function acceptAndGetQr(page: Page): Promise<void> {
  await page.getByTestId("reveal-accept").click();
  await page.getByTestId("delivery-qr").waitFor({ timeout: 45_000 });
}

/**
 * Opens the admin using the session saved by e2e/auth.setup.ts. Specs that need
 * to exercise sign-in itself opt out of that storage state and log in directly.
 */
export async function openAdmin(page: Page, path = "/admin"): Promise<void> {
  await page.goto(path);
  await page.waitForURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: 20_000 });
}
