/**
 * Renders every demo style against a real face and saves a screenshot each.
 *
 * The demo provider's whole point is that it looks like the product, and the
 * only honest way to check that is to look at it. Chromium's default fake
 * camera has no person in it, so this drives the flow with a y4m clip built by
 * `scripts/make-fake-camera.ts` — segmentation and face tracking then run for
 * real, exactly as they would on the iPad.
 *
 *   npx tsx scripts/preview-styles.ts <face.y4m> [outDir] [baseUrl]
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const ALL_STYLES = ["slime-star", "anime-power-up", "royal-fantasy", "become-a-baby"] as const;

/** ONLY_STYLE=royal-fantasy narrows the run while iterating on one look. */
const STYLES = process.env["ONLY_STYLE"]
  ? ALL_STYLES.filter((slug) => slug === process.env["ONLY_STYLE"])
  : ALL_STYLES;

/** 13-inch iPad Pro in portrait — the only screen this ships on. */
const VIEWPORT = { width: 1024, height: 1366 };

/** Long enough for ~16 MB of models to load and the loop to settle. */
const SETTLE_MS = 6_000;

async function runStyle(page: Page, baseUrl: string, slug: string, outDir: string): Promise<void> {
  await page.goto(`${baseUrl}/kiosk`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("screen-attract").waitFor({ timeout: 30_000 });

  await page.getByTestId("attract-start").click();
  await page.getByTestId("screen-style").waitFor();
  await page.getByTestId(`style-card-${slug}`).click();
  await page.getByTestId("style-continue").click();

  await page.getByTestId("screen-purchase").waitFor();
  await page.getByTestId("purchase-pay").click();
  await page.waitForURL(/\/demo\/checkout/, { timeout: 20_000 });
  await page.getByTestId("demo-pay").click();

  await page.getByTestId("screen-consent").waitFor({ timeout: 45_000 });
  await page.getByTestId("consent-agree").click();

  await page.getByTestId("screen-camera").waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="camera-ready"]')?.disabled,
    undefined,
    { timeout: 20_000 },
  );
  await page.getByTestId("camera-ready").click();

  await page.getByTestId("screen-generating").waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="generating-capture"]')?.disabled,
    undefined,
    { timeout: 45_000 },
  );

  // The models load in the background; the first frames are the fallback grade.
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${outDir}/${slug}.png` });

  // Also capture the reveal, which is the frame the customer actually keeps.
  await page.getByTestId("generating-capture").click();
  await page.getByTestId("screen-reveal").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: `${outDir}/${slug}-reveal.png` });

  console.log(`  ${slug}`);
}

async function main(): Promise<void> {
  const clip = process.argv[2];
  const outDir = process.argv[3] ?? "style-previews";
  const baseUrl = process.argv[4] ?? "http://localhost:3000";
  if (!clip) throw new Error("Usage: preview-styles.ts <face.y4m> [outDir] [baseUrl]");

  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
      ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
      : {}),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${resolve(clip)}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const failures: string[] = [];

  console.log(`\nRendering demo styles at ${VIEWPORT.width}×${VIEWPORT.height}\n`);
  for (const slug of STYLES) {
    // A fresh context per style: the kiosk deliberately keeps session state
    // across a reload, and reusing one would start the next run mid-flow.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      permissions: ["camera"],
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`${slug}: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`${slug}: ${error.message}`));

    try {
      await runStyle(page, baseUrl, slug, outDir);
    } catch (error) {
      console.log(`  ${slug} — FAILED: ${(error as Error).message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  await browser.close();

  if (failures.length > 0) {
    console.log("\nConsole errors during the run:");
    for (const message of [...new Set(failures)]) console.log(`  · ${message}`);
  }
  console.log(`\nScreenshots: ${outDir}/\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
