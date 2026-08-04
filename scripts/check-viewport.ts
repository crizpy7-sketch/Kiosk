/**
 * Renders the kiosk at an arbitrary viewport and reports what doesn't fit.
 *
 * The kiosk is designed for one screen — a 13-inch iPad Pro in portrait — so
 * the useful question about any other device is not "does it load" but "what
 * breaks". This walks the flow and, at each screen, measures horizontal
 * overflow and whether the primary action is fully on screen. Those two are
 * what actually stop a customer.
 *
 *   npx tsx scripts/check-viewport.ts <width> <height> [label] [baseUrl]
 */
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "@playwright/test";

interface Finding {
  screen: string;
  overflowPx: number;
  primaryVisible: boolean | null;
  primaryBottom: number | null;
  notes: string[];
}

async function inspect(page: Page, screen: string, primaryTestId: string | null): Promise<Finding> {
  await page.waitForTimeout(500);

  const overflowPx = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  const notes: string[] = await page.evaluate(() => {
    const out: string[] = [];
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a[href], [role='radio']"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;

      // Apple's own minimum is 44pt; anything under that is a mis-tap waiting.
      if (box.height < 44 && el.offsetParent !== null) {
        out.push(`tap target ${Math.round(box.height)}px tall: "${(el.textContent ?? "").trim().slice(0, 28)}"`);
      }
      if (box.right > viewportWidth + 1 || box.left < -1) {
        out.push(`clipped horizontally: "${(el.textContent ?? "").trim().slice(0, 28)}"`);
      }
      if (box.top > viewportHeight) {
        out.push(`below the fold: "${(el.textContent ?? "").trim().slice(0, 28)}"`);
      }
    }
    return [...new Set(out)];
  });

  let primaryVisible: boolean | null = null;
  let primaryBottom: number | null = null;
  if (primaryTestId) {
    const box = await page.getByTestId(primaryTestId).boundingBox().catch(() => null);
    if (box) {
      const height = page.viewportSize()?.height ?? 0;
      primaryBottom = Math.round(box.y + box.height);
      primaryVisible = primaryBottom <= height;
    }
  }

  return { screen, overflowPx, primaryVisible, primaryBottom, notes };
}

async function main(): Promise<void> {
  const width = Number(process.argv[2] ?? 393);
  const height = Number(process.argv[3] ?? 852);
  const label = process.argv[4] ?? `${width}x${height}`;
  const baseUrl = process.argv[5] ?? "http://localhost:3000";
  const outDir = `viewport-${label}`;
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
      ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
      : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    permissions: ["camera"],
  });
  const page = await context.newPage();

  const findings: Finding[] = [];
  const shoot = async (name: string) => page.screenshot({ path: `${outDir}/${name}.png` });

  console.log(`\nChecking the kiosk at ${width}×${height} (${label})\n`);

  await page.goto(`${baseUrl}/kiosk`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("screen-attract").waitFor({ timeout: 30_000 });
  findings.push(await inspect(page, "attract", "attract-start"));
  await shoot("1-attract");

  await page.getByTestId("attract-start").click();
  await page.getByTestId("screen-style").waitFor();
  findings.push(await inspect(page, "choose style", "style-continue"));
  await shoot("2-style");

  await page.getByTestId("style-card-slime-star").click();
  await page.getByTestId("style-continue").click();
  await page.getByTestId("screen-purchase").waitFor();
  findings.push(await inspect(page, "purchase", "purchase-pay"));
  await shoot("3-purchase");

  await page.getByTestId("purchase-pay").click();
  await page.waitForURL(/\/demo\/checkout/, { timeout: 20_000 });
  await page.getByTestId("demo-pay").click();
  await page.getByTestId("screen-consent").waitFor({ timeout: 45_000 });
  findings.push(await inspect(page, "consent", "consent-agree"));
  await shoot("4-consent");

  await page.getByTestId("consent-agree").click();
  await page.getByTestId("screen-camera").waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="camera-ready"]')?.disabled,
    { timeout: 20_000 },
  );
  findings.push(await inspect(page, "camera", "camera-ready"));
  await shoot("5-camera");

  await page.getByTestId("camera-ready").click();
  await page.getByTestId("screen-generating").waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[data-testid="generating-capture"]')?.disabled,
    { timeout: 45_000 },
  );
  findings.push(await inspect(page, "transforming", "generating-capture"));
  await shoot("6-transforming");

  await page.getByTestId("generating-capture").click();
  await page.getByTestId("screen-reveal").waitFor({ timeout: 30_000 });
  findings.push(await inspect(page, "reveal", "reveal-accept"));
  await shoot("7-reveal");

  await page.getByTestId("reveal-accept").click();
  await page.getByTestId("delivery-qr").waitFor({ timeout: 45_000 });
  findings.push(await inspect(page, "QR delivery", "delivery-done"));
  await shoot("8-delivery");

  await context.close();
  await browser.close();

  // ---- report ----
  let problems = 0;
  for (const f of findings) {
    const issues: string[] = [];
    if (f.overflowPx > 1) issues.push(`page scrolls sideways by ${f.overflowPx}px`);
    if (f.primaryVisible === false) {
      issues.push(`primary button ends at ${f.primaryBottom}px — ${f.primaryBottom! - height}px off screen`);
    }
    issues.push(...f.notes);

    if (issues.length === 0) {
      console.log(`  ok    ${f.screen}`);
    } else {
      problems += issues.length;
      console.log(`  FAIL  ${f.screen}`);
      for (const issue of issues) console.log(`          · ${issue}`);
    }
  }

  console.log(`\n${problems === 0 ? "No layout problems found." : `${problems} problem(s) found.`}`);
  console.log(`Screenshots: ${outDir}/\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
