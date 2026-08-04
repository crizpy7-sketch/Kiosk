import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real app in demo mode.
 *
 * The viewport is a 13-inch iPad Pro in portrait — the only screen this product
 * ships on. The fake media stream lets the camera, generation and capture steps
 * run in CI without a physical webcam.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    permissions: ["camera"],
    launchOptions: {
      // This environment ships its own Chromium; PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
      // stops Playwright fetching a matching build, so point at the installed one.
      ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
        ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
        : {}),
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },

  projects: [
    // Signs in once and stores the session; see e2e/auth.setup.ts for why.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 1366 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
    {
      name: "ipad-portrait",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 1366 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
  ],

  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      APP_BASE_URL: BASE_URL,
      DEMO_MODE: "true",
      ALLOW_DEMO_MODE_IN_PRODUCTION: "true",
      DATABASE_URL: process.env["E2E_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "",
      APP_SECRET: process.env["APP_SECRET"] ?? "e2e-secret-that-is-definitely-long-enough-0000",
      KIOSK_ID: process.env["KIOSK_ID"] ?? "kiosk-shia-baby-01",
      STORAGE_DRIVER: "filesystem",
      STORAGE_LOCAL_DIR: ".data/e2e-assets",
      DEFAULT_LANGUAGE: "en",
      SESSION_MAX_SECONDS: "8",
      COUNTDOWN_SECONDS: "2",
      ATTRACT_TIMEOUT_SECONDS: "20",
      DOWNLOAD_LINK_TTL_HOURS: "24",
    },
  },
});
