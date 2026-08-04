/**
 * Records the full customer journey as a video, in demo mode.
 *
 * For showing someone what the kiosk actually does without them having to set
 * up Stripe, Decart, a database or a host first. It drives the real app — the
 * same routes, the same state machine, the same webhook — so what you see is
 * the product, not a mockup.
 *
 *   npx tsx scripts/record-walkthrough.ts [baseUrl] [outDir]
 */
import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const VIEWPORT = { width: 1024, height: 1366 };

/** Slower than a real customer, so the video is followable. */
async function beat(page: Page, ms = 1400): Promise<void> {
  await page.waitForTimeout(ms);
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2] ?? "http://localhost:3000";
  const outDir = process.argv[3] ?? "walkthrough";
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
      ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
      : {}),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    hasTouch: true,
    permissions: ["camera"],
    recordVideo: { dir: outDir, size: VIEWPORT },
  });

  const page = await context.newPage();
  console.log("Recording the full customer journey…");

  await page.goto(`${baseUrl}/kiosk`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("screen-attract").waitFor({ timeout: 30_000 });
  await beat(page, 2600);

  // Both languages, so the viewer sees the toggle work.
  await page.getByTestId("lang-es").click();
  await beat(page, 1800);
  await page.getByTestId("lang-en").click();
  await beat(page);

  await page.getByTestId("attract-start").click();
  await beat(page, 2200);

  await page.getByTestId("style-card-become-a-baby").click();
  await beat(page, 1600);

  await page.getByTestId("style-continue").click();
  await page.getByTestId("screen-purchase").waitFor();
  await beat(page, 2200);

  await page.getByTestId("purchase-pay").click();
  await page.waitForURL(/\/demo\/checkout/, { timeout: 20_000 });
  await beat(page, 2200);

  await page.getByTestId("demo-pay").click();
  await page.getByTestId("screen-consent").waitFor({ timeout: 45_000 });
  await beat(page, 3200);

  await page.getByTestId("consent-agree").click();
  await page.getByTestId("screen-camera").waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="camera-ready"]')?.disabled,
    { timeout: 20_000 },
  );
  await beat(page, 2600);

  await page.getByTestId("camera-ready").click();
  await page.getByTestId("screen-generating").waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="generating-capture"]')?.disabled,
    { timeout: 45_000 },
  );
  await beat(page, 2600);

  await page.getByTestId("generating-capture").click();
  await page.getByTestId("screen-reveal").waitFor({ timeout: 30_000 });
  await beat(page, 3200);

  await page.getByTestId("reveal-accept").click();
  await page.getByTestId("delivery-qr").waitFor({ timeout: 45_000 });
  await beat(page, 3600);

  await page.getByTestId("delivery-done").click();
  await page.getByTestId("screen-thanks").waitFor({ timeout: 10_000 });
  await beat(page, 2600);

  // Back to attract, ready for the next customer.
  await page.getByTestId("screen-attract").waitFor({ timeout: 20_000 });
  await beat(page, 2200);

  await context.close();
  await browser.close();

  // Playwright names videos with a random id; give it something recognisable.
  const files = (await readdir(outDir)).filter((f) => f.endsWith(".webm"));
  const newest = files.at(-1);
  if (newest) {
    await rename(join(outDir, newest), join(outDir, "wild-frame-ai-walkthrough.webm"));
    console.log(`\nVideo: ${outDir}/wild-frame-ai-walkthrough.webm`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
