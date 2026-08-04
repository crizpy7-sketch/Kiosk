/**
 * Drives the real kiosk in Chromium at 13" iPad Pro portrait and captures every
 * customer-facing screen.
 *
 * This is the inspection loop, not a test: it opens the actual rendered product
 * so the result can be compared against the design references by eye.
 *
 *   npx tsx scripts/screenshot.ts [baseUrl] [outDir]
 */
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "@playwright/test";

// 13-inch iPad Pro, portrait, at CSS pixels.
const VIEWPORT = { width: 1024, height: 1366 };

async function shoot(page: Page, dir: string, name: string): Promise<void> {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`  ✓ ${name}.png`);
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2] ?? "http://localhost:3000";
  const outDir = process.argv[3] ?? "screenshots";
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    // Pinned to the browser this environment ships. Playwright's own download
    // is disabled here (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD), so when the bundled
    // revision does not match the installed one we point at it explicitly.
    ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
      ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
      : {}),
    args: [
      // Feed the camera a synthetic moving image so the camera, generation and
      // reveal screens can be captured without a physical webcam.
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    // 1x: these are read on a screen, not printed, and 2x quadruples the bytes
    // for a preview nobody zooms into.
    deviceScaleFactor: Number(process.env["WF_SCALE"] ?? 2),
    hasTouch: true,
    isMobile: false,
    permissions: ["camera"],
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.error("  [browser]", message.text());
  });

  console.log(`Capturing ${VIEWPORT.width}×${VIEWPORT.height} (13" iPad Pro portrait)…`);

  // 1 — Attract (English)
  // domcontentloaded + an explicit element wait: the kiosk holds a heartbeat
  // and a status poll open, so "networkidle" never arrives by design.
  await page.goto(`${baseUrl}/kiosk`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("screen-attract").waitFor({ timeout: 30_000 });
  await shoot(page, outDir, "01-attract-en");

  // 1b — Attract (Spanish)
  await page.getByTestId("lang-es").click();
  await shoot(page, outDir, "02-attract-es");
  await page.getByTestId("lang-en").click();

  // 1c — Privacy sheet
  await page.getByTestId("attract-privacy").click();
  await shoot(page, outDir, "03-privacy-sheet");
  await page.getByTestId("info-sheet-close").click();

  // 2 — Choose style
  await page.getByTestId("attract-start").click();
  await shoot(page, outDir, "04-style-empty");

  await page.getByTestId("style-card-become-a-baby").click();
  await shoot(page, outDir, "05-style-selected");

  // 3 — Purchase
  await page.getByTestId("style-continue").click();
  await page.getByTestId("screen-purchase").waitFor();
  await shoot(page, outDir, "06-purchase");

  // 3b — Demo checkout
  await page.getByTestId("purchase-pay").click();
  await page.waitForURL(/\/demo\/checkout/, { timeout: 15_000 });
  await shoot(page, outDir, "07-demo-checkout");

  // 4 — Consent
  await page.getByTestId("demo-pay").click();
  await page.getByTestId("screen-consent").waitFor({ timeout: 30_000 });
  await shoot(page, outDir, "08-consent");

  // 5 — Camera
  await page.getByTestId("consent-agree").click();
  await page.getByTestId("screen-camera").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  await shoot(page, outDir, "09-camera");

  // 6 — Countdown, then live transformation
  await page.getByTestId("camera-ready").click();
  await page.getByTestId("countdown").waitFor({ timeout: 20_000 });
  await shoot(page, outDir, "10-countdown");

  await page.getByTestId("generating-capture").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="generating-capture"]')?.disabled,
    { timeout: 20_000 },
  );
  await shoot(page, outDir, "11-transforming");

  // 7 — Reveal
  await page.getByTestId("generating-capture").click();
  await page.getByTestId("screen-reveal").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await shoot(page, outDir, "12-reveal");

  // 8 — QR delivery
  await page.getByTestId("reveal-accept").click();
  await page.getByTestId("delivery-qr").waitFor({ timeout: 30_000 });
  await shoot(page, outDir, "13-delivery-qr");

  // 9 — Thank you / reset
  await page.getByTestId("delivery-done").click();
  await page.getByTestId("screen-thanks").waitFor({ timeout: 10_000 });
  await shoot(page, outDir, "14-thank-you");

  // Customer's phone: the download page at an iPhone viewport.
  const phone = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  const downloadUrl = process.env["WF_DOWNLOAD_URL"];
  if (downloadUrl) {
    await phonePage.goto(downloadUrl, { waitUntil: "domcontentloaded" });
    await shoot(phonePage, outDir, "15-phone-download");
  }

  await browser.close();
  console.log(`\nScreenshots written to ${outDir}/`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
