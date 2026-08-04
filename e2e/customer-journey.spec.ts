import { expect, test } from "@playwright/test";
import {
  acceptAndGetQr,
  consentAndOpenCamera,
  generateAndCapture,
  payInDemo,
  startOrder,
} from "./helpers";

/**
 * The critical customer journey, end to end, in a real browser at 13" iPad Pro
 * portrait. Every scenario the brief lists as required is here.
 */

test.describe("customer journey", () => {
  test("1 — English purchase through QR delivery", async ({ page }) => {
    await startOrder(page, "slime-star");
    await expect(page.getByTestId("purchase-price")).toHaveText("$5.99");

    await payInDemo(page);
    await consentAndOpenCamera(page);
    await generateAndCapture(page);
    await acceptAndGetQr(page);

    await expect(page.getByTestId("delivery-qr")).toBeVisible();
    await expect(page.getByTestId("delivery-expiry")).toContainText("24");
    await expect(page.getByText("YOUR PHOTO IS READY!")).toBeVisible();
  });

  test("2 — Spanish purchase through QR delivery, with no English leaking in", async ({ page }) => {
    await page.goto("/kiosk");
    await page.getByTestId("lang-es").click();

    await expect(page.getByText("ENTRA. CONVIÉRTETE EN LO QUE QUIERAS.")).toBeVisible();
    await expect(page.getByTestId("attract-start")).toContainText("EMPEZAR");

    await page.getByTestId("attract-start").click();
    await expect(page.getByText("ELIGE TU ESTILO IA")).toBeVisible();
    // Card labels must follow the toggle, not the server default.
    await expect(page.getByText("Estrella Slime")).toBeVisible();

    await page.getByTestId("style-card-royal-fantasy").click();
    await page.getByTestId("style-continue").click();
    await expect(page.getByText("TRANSFORMACIÓN IA")).toBeVisible();

    await payInDemo(page);
    await expect(page.getByText("ANTES DE EMPEZAR")).toBeVisible();

    await consentAndOpenCamera(page);
    await expect(page.getByText("¡MIRA A LA CÁMARA Y SONRÍE!")).toBeVisible();

    await generateAndCapture(page);
    await expect(page.getByText("¿QUÉ TE PARECE?")).toBeVisible();

    await acceptAndGetQr(page);
    await expect(page.getByText("¡TU FOTO ESTÁ LISTA!")).toBeVisible();
  });

  test("3 — Become a Baby is offered, badged NEW, and completes", async ({ page }) => {
    await page.goto("/kiosk");
    await page.getByTestId("attract-start").click();

    const card = page.getByTestId("style-card-become-a-baby");
    await expect(card).toBeVisible();
    await expect(card).toContainText("NEW!");
    await expect(card).toContainText(/become a baby/i);

    await card.click();
    await expect(card).toHaveAttribute("data-selected", "true");

    await page.getByTestId("style-continue").click();
    await payInDemo(page);

    // The fiction disclaimer must be on the consent screen, not buried.
    await expect(page.getByText(/does not predict a real child/i)).toBeVisible();

    await consentAndOpenCamera(page);
    await generateAndCapture(page);
    await acceptAndGetQr(page);
    await expect(page.getByTestId("delivery-qr")).toBeVisible();
  });

  test("4 — payment cancellation returns to purchase with a reassuring message", async ({ page }) => {
    await startOrder(page, "anime-power-up");
    await page.getByTestId("purchase-pay").click();
    await page.waitForURL(/\/demo\/checkout/);

    await page.getByTestId("demo-cancel").click();

    await page.getByTestId("screen-purchase").waitFor({ timeout: 30_000 });
    await expect(page.getByTestId("purchase-canceled")).toContainText("Nothing was charged");
  });

  test("5 — camera denied shows a staff-help screen, not a browser error", async ({ page, context }) => {
    await context.clearPermissions();
    await context.grantPermissions([]);
    // Force getUserMedia to reject the way iPadOS does when access is blocked.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
        },
      });
    });

    await startOrder(page, "slime-star");
    await payInDemo(page);
    await page.getByTestId("consent-agree").click();

    await page.getByTestId("screen-camera-denied").waitFor({ timeout: 30_000 });
    await expect(page.getByText(/payment is protected/i)).toBeVisible();
  });

  test("6 — AI failure after payment lands on a recoverable screen with the reference", async ({ page }) => {
    // Make the token endpoint fail after the customer has already paid.
    await startOrder(page, "slime-star");
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
    await expect(page.getByTestId("error-message")).toContainText(/payment is protected/i);
    // The reference is on screen so staff can find the order without asking.
    await expect(page.getByText(/^WF-/)).toBeVisible();
  });

  test("7 & 8 — one retake is allowed, a second is not offered", async ({ page }) => {
    await startOrder(page, "slime-star");
    await payInDemo(page);
    await consentAndOpenCamera(page);
    await generateAndCapture(page);

    await expect(page.getByTestId("reveal-retake")).toBeVisible();
    await page.getByTestId("reveal-retake").click();

    // Second generation runs, then the reveal comes back without the retake.
    await page.getByTestId("screen-generating").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('[data-testid="generating-capture"]')?.disabled,
      { timeout: 45_000 },
    );
    await page.getByTestId("generating-capture").click();
    await page.getByTestId("screen-reveal").waitFor({ timeout: 30_000 });

    await expect(page.getByTestId("reveal-retake")).toHaveCount(0);
    await expect(page.getByTestId("reveal-retake-used")).toBeVisible();
  });

  test("9 — the QR link downloads a real photo on a phone", async ({ page, browser }) => {
    await startOrder(page, "slime-star");
    await payInDemo(page);
    await consentAndOpenCamera(page);
    await generateAndCapture(page);

    // Capture the delivery URL from the API response the kiosk just received.
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/capture") && response.status() === 200,
    );
    await page.getByTestId("reveal-accept").click();
    const body = (await (await responsePromise).json()) as { downloadUrl: string };

    await page.getByTestId("delivery-qr").waitFor({ timeout: 45_000 });

    const phone = await browser.newContext({
      viewport: { width: 393, height: 852 },
      hasTouch: true,
      isMobile: true,
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(body.downloadUrl);

    await expect(phonePage.getByText("YOUR PHOTO IS READY")).toBeVisible();
    await expect(phonePage.getByTestId("download-button")).toBeVisible();
    await expect(phonePage.getByText(/expires in/i)).toBeVisible();
    // No account and no social affordances: the page hands over a photo and
    // stops. (The word "gallery" does appear — in the promise not to have one.)
    await expect(phonePage.getByRole("button", { name: /sign up|create account|log in/i })).toHaveCount(0);
    await expect(phonePage.getByRole("textbox")).toHaveCount(0);
    await expect(phonePage.getByText(/no public gallery/i)).toBeVisible();

    await phone.close();
  });

  test("10 — the kiosk resets itself to attract after completion", async ({ page }) => {
    await startOrder(page, "slime-star");
    await payInDemo(page);
    await consentAndOpenCamera(page);
    await generateAndCapture(page);
    await acceptAndGetQr(page);

    await page.getByTestId("delivery-done").click();
    await page.getByTestId("screen-thanks").waitFor();
    await page.getByTestId("screen-attract").waitFor({ timeout: 20_000 });

    // No trace of the last customer in storage.
    const stored = await page.evaluate(() => sessionStorage.getItem("wf_active_order"));
    expect(stored).toBeNull();
  });

  test("11 — inactivity returns the kiosk to attract", async ({ page }) => {
    await startOrder(page, "slime-star");
    // ATTRACT_TIMEOUT_SECONDS is 20 in the E2E environment.
    await page.getByTestId("screen-attract").waitFor({ timeout: 40_000 });
  });

  test("12 — a reload mid-order resumes rather than losing the customer's money", async ({ page }) => {
    await startOrder(page, "slime-star");
    await payInDemo(page);
    await expect(page.getByTestId("screen-consent")).toBeVisible();

    await page.reload();

    // Server state, not browser state, decides where they land.
    await page.getByTestId("screen-consent").waitFor({ timeout: 30_000 });
  });

  test("13 — consecutive customers share no state", async ({ page }) => {
    await startOrder(page, "slime-star");
    await payInDemo(page);
    await consentAndOpenCamera(page);
    await generateAndCapture(page);
    await acceptAndGetQr(page);
    await page.getByTestId("delivery-done").click();
    await page.getByTestId("screen-attract").waitFor({ timeout: 20_000 });

    // Second customer: nothing is preselected and the language is back to default.
    await page.getByTestId("attract-start").click();
    await expect(page.getByTestId("style-continue")).toBeDisabled();
    await expect(page.getByTestId("style-card-slime-star")).toHaveAttribute("data-selected", "false");

    await page.getByTestId("style-card-anime-power-up").click();
    await page.getByTestId("style-continue").click();
    await payInDemo(page);
    await expect(page.getByTestId("screen-consent")).toBeVisible();
  });
});

test.describe("kiosk chrome", () => {
  test("shows the demo badge so staff always know it is not live", async ({ page }) => {
    await page.goto("/kiosk");
    await expect(page.getByText("DEMO — NO CHARGE")).toBeVisible();
  });

  test("keeps every primary action on screen in portrait, above the fold", async ({ page }) => {
    await page.goto("/kiosk");

    const start = page.getByTestId("attract-start");
    const box = await start.boundingBox();
    expect(box).not.toBeNull();
    // Fully visible within the 1366px-tall viewport, and a generous touch target.
    expect(box!.y + box!.height).toBeLessThanOrEqual(1366);
    expect(box!.height).toBeGreaterThanOrEqual(64);
  });

  test("privacy notice is reachable without starting a purchase", async ({ page }) => {
    await page.goto("/kiosk");
    await page.getByTestId("attract-privacy").click();
    await expect(page.getByTestId("info-sheet")).toBeVisible();
    await expect(page.getByText(/no public gallery/i)).toBeVisible();
    await expect(page.getByText(/face recognition/i)).toBeVisible();
    await page.getByTestId("info-sheet-close").click();
    await expect(page.getByTestId("info-sheet")).toHaveCount(0);
  });
});
