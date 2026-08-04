import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, query } from "@/lib/db/client";
import { createOrder, getOrderById, transitionOrder } from "@/lib/orders/repository";
import { resetRateLimits } from "@/lib/security/rate-limit";

/**
 * API authorization tests.
 *
 * These call the real route handlers with real Request objects against the real
 * database — no mocked repository, no stubbed state machine. They are the tests
 * that answer the question the brief cares most about: *can an unpaid customer
 * obtain a paid AI session?*
 *
 * `next/headers` is stubbed because these handlers do not use cookies; the
 * admin-session path is covered separately by the E2E suite, which drives a
 * real browser through a real login.
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

const KIOSK_ID = process.env["KIOSK_ID"] ?? "kiosk-test-01";

function post(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": randomIp() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Distinct source per request so the rate limiter never masks a real result. */
function randomIp(): string {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function freshOrder() {
  return createOrder({
    kioskId: KIOSK_ID,
    experienceId: "exp_slime_star",
    language: "en",
    priceCents: 599,
    demo: true,
  });
}

/** Drives an order to the point where an AI session is legitimately allowed. */
async function authorizedOrder() {
  const order = await freshOrder();
  await transitionOrder(order.id, "payment_pending");
  await transitionOrder(order.id, "paid", { paidAt: new Date() });
  await transitionOrder(order.id, "consented", { consentedAt: new Date() });
  await transitionOrder(order.id, "generation_authorized");
  return order;
}

beforeEach(async () => {
  resetRateLimits();
  await query("DELETE FROM audit_events");
  await query("DELETE FROM webhook_events");
  await query("DELETE FROM assets");
  await query("DELETE FROM generation_sessions");
  await query("DELETE FROM orders");
});

afterAll(async () => {
  await closePool();
});

describe("POST /api/orders", () => {
  it("creates an order at the server-side price, ignoring anything the client sends", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const request = post("http://localhost:3000/api/orders", {
      experienceSlug: "slime-star",
      language: "en",
      // Not part of the schema, and must have no effect even if it were sent.
      priceCents: 1,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { priceCents: number; orderId: string };
    expect(body.priceCents).toBe(599);
  });

  it("rejects an unknown style", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(post("http://localhost:3000/api/orders", { experienceSlug: "hacker-style", language: "en" }));
    expect(response.status).toBe(404);
  });

  it("rejects a malformed body", async () => {
    const { POST } = await import("@/app/api/orders/route");
    expect((await POST(post("http://localhost:3000/api/orders", { experienceSlug: "../../etc", language: "en" }))).status).toBe(400);
    expect((await POST(post("http://localhost:3000/api/orders", { language: "de" }))).status).toBe(400);
    expect((await POST(post("http://localhost:3000/api/orders"))).status).toBe(400);
  });
});

describe("POST /api/ai/session — the gate protecting AI credits", () => {
  it("REFUSES an unpaid order", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await freshOrder();

    const response = await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("NOT_AUTHORIZED");
    // Nothing was started, so nothing can be billed.
    const sessions = await query("SELECT * FROM generation_sessions WHERE order_id = $1", [order.id]);
    expect(sessions).toHaveLength(0);
  });

  it("REFUSES a paid order that has not consented", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });

    const response = await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }));
    expect(response.status).toBe(403);
  });

  it("REFUSES an order that is merely mid-checkout", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    expect((await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }))).status).toBe(403);
  });

  it("REFUSES an expired order", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "expired");

    expect((await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }))).status).toBe(403);
  });

  it("REFUSES a refunded order", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });
    await transitionOrder(order.id, "refund_pending");
    await transitionOrder(order.id, "refunded", { refundedAt: new Date() });

    expect((await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }))).status).toBe(403);
  });

  it("REFUSES an unknown order id", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const response = await POST(
      post("http://localhost:3000/api/ai/session", { orderId: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(response.status).toBe(404);
  });

  it("GRANTS a token to a paid, consented, authorized order", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await authorizedOrder();

    const response = await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }));
    expect(response.status).toBe(200);

    const grant = (await response.json()) as {
      clientToken: string;
      maxSessionSeconds: number;
      prompt: string;
      generationSessionId: string;
    };

    expect(grant.clientToken).toBeTruthy();
    expect(grant.maxSessionSeconds).toBeLessThanOrEqual(15);
    expect(grant.prompt).toContain("Avoid:");
    expect(grant.generationSessionId).toBeTruthy();

    expect((await getOrderById(order.id))?.status).toBe("generating");
  });

  it("never returns a permanent credential to the browser", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await authorizedOrder();

    const response = await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }));
    const raw = await response.text();

    expect(raw).not.toContain("sk_");
    expect(raw).not.toContain("whsec_");
    expect(raw.toLowerCase()).not.toContain("decart_api_key");
    expect(raw).not.toContain(process.env["APP_SECRET"] ?? "__unset__");
  });

  it("REFUSES a second session for an order already generating", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await authorizedOrder();

    expect((await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }))).status).toBe(200);
    // Now `generating`, which is not a state a fresh session may be minted from.
    expect((await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }))).status).toBe(403);
  });

  it("allows exactly one retake and refuses the second", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await authorizedOrder();

    await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }));
    await transitionOrder(order.id, "captured", { generationCompletedAt: new Date() });

    const first = await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id, retake: true }));
    expect(first.status).toBe(200);

    await transitionOrder(order.id, "captured", { generationCompletedAt: new Date() });

    const second = await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id, retake: true }));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("RETAKE_NOT_ALLOWED");
  });

  it("refuses when the kiosk's daily AI budget is spent", async () => {
    const { POST } = await import("@/app/api/ai/session/route");
    const order = await authorizedOrder();

    await query("UPDATE kiosks SET daily_ai_limit_seconds = 1 WHERE id = $1", [KIOSK_ID]);
    await query(
      `INSERT INTO generation_sessions (order_id, provider, model, status, billable_seconds_estimate)
       VALUES ($1, 'mock', 'lucy-restyle-2', 'completed', 500)`,
      [order.id],
    );

    const response = await POST(post("http://localhost:3000/api/ai/session", { orderId: order.id }));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("DAILY_LIMIT_REACHED");

    await query("UPDATE kiosks SET daily_ai_limit_seconds = 3600 WHERE id = $1", [KIOSK_ID]);
  });
});

describe("POST /api/orders/[orderId]/consent", () => {
  it("records consent for a paid order and authorizes generation", async () => {
    const { POST } = await import("@/app/api/orders/[orderId]/consent/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });

    const response = await POST(post("http://localhost:3000/api/consent", { agreed: true }), {
      params: Promise.resolve({ orderId: order.id }),
    });

    expect(response.status).toBe(200);
    const updated = await getOrderById(order.id);
    expect(updated?.status).toBe("generation_authorized");
    expect(updated?.consented_at).not.toBeNull();
  });

  it("refuses consent for an unpaid order", async () => {
    const { POST } = await import("@/app/api/orders/[orderId]/consent/route");
    const order = await freshOrder();

    const response = await POST(post("http://localhost:3000/api/consent", { agreed: true }), {
      params: Promise.resolve({ orderId: order.id }),
    });

    expect(response.status).toBe(409);
    expect((await getOrderById(order.id))?.status).toBe("created");
  });

  it("refuses without explicit agreement", async () => {
    const { POST } = await import("@/app/api/orders/[orderId]/consent/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });

    for (const body of [{ agreed: false }, {}, { agreed: "yes" }]) {
      const response = await POST(post("http://localhost:3000/api/consent", body), {
        params: Promise.resolve({ orderId: order.id }),
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("POST /api/checkout", () => {
  it("creates a session and moves the order to payment_pending", async () => {
    const { POST } = await import("@/app/api/checkout/route");
    const order = await freshOrder();

    const response = await POST(post("http://localhost:3000/api/checkout", { orderId: order.id }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { checkoutUrl: string; demo: boolean };
    expect(body.demo).toBe(true);
    expect(body.checkoutUrl).toContain("/demo/checkout");
    expect((await getOrderById(order.id))?.status).toBe("payment_pending");
  });

  it("refuses a second checkout for the same order", async () => {
    const { POST } = await import("@/app/api/checkout/route");
    const order = await freshOrder();

    expect((await POST(post("http://localhost:3000/api/checkout", { orderId: order.id }))).status).toBe(200);
    const second = await POST(post("http://localhost:3000/api/checkout", { orderId: order.id }));
    expect(second.status).toBe(409);
  });

  it("refuses checkout for an order that already paid", async () => {
    const { POST } = await import("@/app/api/checkout/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });

    expect((await POST(post("http://localhost:3000/api/checkout", { orderId: order.id }))).status).toBe(409);
  });
});

describe("POST /api/webhooks/stripe", () => {
  it("rejects an unsigned request without touching the order", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    const response = await POST(
      new Request("http://localhost:3000/api/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify({ id: "evt_forged", type: "checkout.completed", order_id: order.id, paid: true }),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_SIGNATURE");
    expect((await getOrderById(order.id))?.status).toBe("payment_pending");
  });

  it("rejects a forged signature", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    const response = await POST(
      new Request("http://localhost:3000/api/webhooks/stripe", {
        method: "POST",
        headers: { "x-demo-signature": "demo,v1=deadbeef" },
        body: JSON.stringify({ id: "evt_forged", type: "checkout.completed", order_id: order.id, paid: true }),
      }),
    );

    expect(response.status).toBe(400);
    expect((await getOrderById(order.id))?.status).toBe("payment_pending");
  });

  it("accepts a correctly signed webhook and fulfils exactly once", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const { signMockWebhook } = await import("@/lib/payments/mock.server");

    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    const body = JSON.stringify({
      id: "evt_signed_1",
      type: "checkout.completed",
      order_id: order.id,
      checkout_session_id: "cs_demo_1",
      amount_total: 599,
      paid: true,
    });

    const send = () =>
      POST(
        new Request("http://localhost:3000/api/webhooks/stripe", {
          method: "POST",
          headers: { "x-demo-signature": signMockWebhook(body) },
          body,
        }),
      );

    expect((await send()).status).toBe(200);
    expect((await getOrderById(order.id))?.status).toBe("paid");

    const duplicate = await send();
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).duplicate).toBe(true);
  });
});

describe("GET /api/download/[token]", () => {
  it("404s an unknown token", async () => {
    const { GET } = await import("@/app/api/download/[token]/route");
    const { createDeliveryToken } = await import("@/lib/delivery/tokens");

    const response = await GET(new Request("http://localhost:3000/api/download/x"), {
      params: Promise.resolve({ token: createDeliveryToken().token }),
    });
    expect(response.status).toBe(404);
  });

  it("404s a malformed token without querying anything", async () => {
    const { GET } = await import("@/app/api/download/[token]/route");
    for (const token of ["../../etc/passwd", "short", "'; DROP TABLE assets;--"]) {
      const response = await GET(new Request("http://localhost:3000/api/download/x"), {
        params: Promise.resolve({ token }),
      });
      expect(response.status).toBe(404);
    }
  });

  it("serves a live asset and 404s the same asset once expired", async () => {
    const { GET } = await import("@/app/api/download/[token]/route");
    const { createDeliveryToken } = await import("@/lib/delivery/tokens");
    const { createAsset } = await import("@/lib/db/repositories");
    const { getStorage } = await import("@/lib/storage/index.server");

    const order = await freshOrder();
    const { token, tokenHash } = createDeliveryToken();
    const path = `orders/test/${order.id}/photo.jpg`;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

    await getStorage().put(path, jpeg, "image/jpeg");
    const asset = await createAsset({
      orderId: order.id,
      privateStoragePath: path,
      contentType: "image/jpeg",
      byteSize: jpeg.byteLength,
      downloadTokenHash: tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const live = await GET(new Request("http://localhost:3000/api/download/x"), {
      params: Promise.resolve({ token }),
    });
    expect(live.status).toBe(200);
    expect(live.headers.get("Content-Type")).toBe("image/jpeg");
    expect(live.headers.get("Cache-Control")).toContain("no-store");

    await query("UPDATE assets SET expires_at = now() - interval '1 hour' WHERE id = $1", [asset.id]);

    const expired = await GET(new Request("http://localhost:3000/api/download/x"), {
      params: Promise.resolve({ token }),
    });
    expect(expired.status).toBe(404);
  });
});

describe("POST /api/demo/settle", () => {
  it("drives a real fulfilment through the same verified path", async () => {
    const { POST } = await import("@/app/api/demo/settle/route");
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    const response = await POST(
      post("http://localhost:3000/api/demo/settle", {
        sessionId: "cs_demo_settle",
        orderId: order.id,
        amountCents: 599,
        outcome: "paid",
      }),
    );

    expect(response.status).toBe(200);
    expect((await getOrderById(order.id))?.status).toBe("paid");
  });
});
