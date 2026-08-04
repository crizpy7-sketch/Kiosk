import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, isDemoAi, isDemoMode, isDemoPayments, resetEnvCache } from "@/lib/env";

/**
 * The payment and AI adapters can be switched independently, which exists so a
 * kiosk can be pointed at real Decart while checkout stays mocked — the cheapest
 * way to see genuine output without opening a Stripe account.
 *
 * The combination that must never be reachable is the mirror image: real money
 * taken for a watermarked simulation.
 */

const BASE = {
  DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/wildframe_test",
  APP_SECRET: "a-test-secret-that-is-definitely-long-enough-000",
  NODE_ENV: "development",
} as const;

let saved: NodeJS.ProcessEnv;

function setEnv(overrides: Record<string, string>): void {
  process.env = { ...BASE, ...overrides } as NodeJS.ProcessEnv;
  resetEnvCache();
}

beforeEach(() => {
  saved = process.env;
});

afterEach(() => {
  process.env = saved;
  resetEnvCache();
});

describe("demo adapter switching", () => {
  it("defaults both adapters to DEMO_MODE", () => {
    setEnv({ DEMO_MODE: "true" });
    expect(isDemoPayments()).toBe(true);
    expect(isDemoAi()).toBe(true);
    expect(isDemoMode()).toBe(true);
  });

  it("requires real credentials when both adapters are live", () => {
    setEnv({ DEMO_MODE: "false" });
    expect(() => getEnv()).toThrow(/STRIPE_SECRET_KEY|DECART_API_KEY/);
  });

  it("allows live AI with mocked checkout, given a Decart key", () => {
    setEnv({ DEMO_MODE: "true", DEMO_AI: "false", DECART_API_KEY: "sk-decart-test" });
    expect(isDemoPayments()).toBe(true);
    expect(isDemoAi()).toBe(false);
    // Still "demo" overall, so the kiosk badge and admin banner stay visible.
    expect(isDemoMode()).toBe(true);
  });

  it("refuses live AI without a Decart key", () => {
    setEnv({ DEMO_MODE: "true", DEMO_AI: "false" });
    expect(() => getEnv()).toThrow(/DECART_API_KEY/);
  });

  it("refuses to take real payments while the AI is simulated", () => {
    setEnv({
      DEMO_MODE: "false",
      DEMO_AI: "true",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      DECART_API_KEY: "sk-decart-test",
    });
    expect(() => getEnv()).toThrow(/charges a customer for a watermarked mock/);
  });

  it("refuses that combination in development too — there is no flag for it", () => {
    setEnv({
      NODE_ENV: "development",
      DEMO_PAYMENTS: "false",
      DEMO_AI: "true",
      ALLOW_DEMO_MODE_IN_PRODUCTION: "true",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    });
    expect(() => getEnv()).toThrow(/charges a customer for a watermarked mock/);
  });

  it("refuses any simulated adapter in production unless deliberately allowed", () => {
    setEnv({
      NODE_ENV: "production",
      APP_BASE_URL: "https://kiosk.example.com",
      DEMO_PAYMENTS: "true",
      DEMO_AI: "false",
      DECART_API_KEY: "sk-decart-test",
    });
    expect(() => getEnv()).toThrow(/cannot be enabled in production/);
  });
});
