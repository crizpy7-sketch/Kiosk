import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, query } from "@/lib/db/client";
import { createOrder, getOrderById, transitionOrder, expireAbandonedOrders } from "@/lib/orders/repository";
import { InvalidTransitionError } from "@/lib/orders/state-machine";
import { applyPaymentEvent } from "@/lib/orders/fulfillment";
import { mockPaymentProvider, signMockWebhook } from "@/lib/payments/mock.server";
import { PaymentProviderError, type PaymentEvent } from "@/lib/payments/provider";
import { normalizeStripeEvent } from "@/lib/payments/stripe.server";
import type Stripe from "stripe";

/**
 * Integration tests against a real PostgreSQL database.
 *
 * These exercise the guarantees that only a real database can demonstrate:
 * the compare-and-set transition, the UNIQUE constraint that makes webhook
 * fulfilment idempotent, and the row locking that keeps two concurrent callers
 * from both winning.
 */

const KIOSK_ID = process.env["KIOSK_ID"] ?? "kiosk-test-01";

async function freshOrder(priceCents = 599) {
  return createOrder({
    kioskId: KIOSK_ID,
    experienceId: "exp_slime_star",
    language: "en",
    priceCents,
    demo: true,
  });
}

function paidEvent(orderId: string, overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    eventId: `evt_${Math.random().toString(36).slice(2)}`,
    type: "checkout.completed",
    orderId,
    checkoutSessionId: `cs_${Math.random().toString(36).slice(2)}`,
    paymentIntentId: "pi_test",
    amountTotalCents: 599,
    paid: true,
    ...overrides,
  };
}

beforeEach(async () => {
  await query("DELETE FROM audit_events");
  await query("DELETE FROM webhook_events");
  await query("DELETE FROM assets");
  await query("DELETE FROM generation_sessions");
  await query("DELETE FROM orders");
});

afterAll(async () => {
  await closePool();
});

describe("order creation", () => {
  it("creates an order in `created` with a random public reference", async () => {
    const order = await freshOrder();
    expect(order.status).toBe("created");
    expect(order.public_reference).toMatch(/^WF-[A-Z2-9]{8}$/);
    expect(order.price_cents).toBe(599);
    expect(order.retake_used).toBe(false);
  });

  it("does not leak sales volume through sequential references", async () => {
    const references = new Set<string>();
    for (let i = 0; i < 25; i += 1) references.add((await freshOrder()).public_reference);
    expect(references.size).toBe(25);
  });

  it("writes an audit row on creation", async () => {
    const order = await freshOrder();
    const rows = await query<{ event_type: string }>(
      "SELECT event_type FROM audit_events WHERE order_id = $1",
      [order.id],
    );
    expect(rows.map((r) => r.event_type)).toContain("order.created");
  });
});

describe("transitions", () => {
  it("applies a legal transition and stamps the timestamp", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    const paidAt = new Date();
    const updated = await transitionOrder(order.id, "paid", { paidAt });

    expect(updated.status).toBe("paid");
    expect(updated.paid_at?.getTime()).toBeCloseTo(paidAt.getTime(), -3);
  });

  it("refuses an illegal transition", async () => {
    const order = await freshOrder();
    await expect(transitionOrder(order.id, "delivered")).rejects.toThrow(InvalidTransitionError);
    expect((await getOrderById(order.id))?.status).toBe("created");
  });

  it("refuses to repeat a transition", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });
    await expect(transitionOrder(order.id, "paid")).rejects.toThrow(InvalidTransitionError);
  });

  it("lets only one of two concurrent callers win", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    const results = await Promise.allSettled([
      transitionOrder(order.id, "paid", { paidAt: new Date() }),
      transitionOrder(order.id, "paid", { paidAt: new Date() }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("audits every transition with both endpoints", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending", { actorLabel: "kiosk" });

    const rows = await query<{ safe_metadata: { from?: string; to?: string } }>(
      "SELECT safe_metadata FROM audit_events WHERE order_id = $1 AND event_type = 'order.payment_pending'",
      [order.id],
    );
    expect(rows[0]?.safe_metadata.from).toBe("created");
    expect(rows[0]?.safe_metadata.to).toBe("payment_pending");
  });
});

describe("webhook fulfilment", () => {
  it("marks a paid order paid", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    const outcome = await applyPaymentEvent("stripe", paidEvent(order.id));
    expect(outcome.duplicate).toBe(false);
    expect((await getOrderById(order.id))?.status).toBe("paid");
  });

  it("ignores a duplicate delivery of the same event", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    const event = paidEvent(order.id);
    const first = await applyPaymentEvent("stripe", event);
    const second = await applyPaymentEvent("stripe", event);
    const third = await applyPaymentEvent("stripe", event);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(true);

    const rows = await query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE order_id = $1 AND event_type = 'order.paid'",
      [order.id],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("absorbs concurrent duplicate deliveries", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    const event = paidEvent(order.id);

    const outcomes = await Promise.all([
      applyPaymentEvent("stripe", event),
      applyPaymentEvent("stripe", event),
      applyPaymentEvent("stripe", event),
    ]);

    expect(outcomes.filter((o) => !o.duplicate)).toHaveLength(1);
    expect((await getOrderById(order.id))?.status).toBe("paid");
  });

  it("does NOT mark a completed-but-unpaid session as paid", async () => {
    // Delayed payment methods complete the Checkout Session before settling.
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    await applyPaymentEvent("stripe", paidEvent(order.id, { paid: false }));
    expect((await getOrderById(order.id))?.status).toBe("payment_pending");
  });

  it("fails an order whose charged amount does not match its price", async () => {
    const order = await freshOrder(599);
    await transitionOrder(order.id, "payment_pending");

    await applyPaymentEvent("stripe", paidEvent(order.id, { amountTotalCents: 50 }));

    const updated = await getOrderById(order.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error_code).toBe("PAYMENT_AMOUNT_MISMATCH");
  });

  it("marks a failed payment failed", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    await applyPaymentEvent("stripe", paidEvent(order.id, { type: "payment.failed", paid: false }));
    const updated = await getOrderById(order.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error_code).toBe("PAYMENT_FAILED");
  });

  it("expires an abandoned checkout", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");

    await applyPaymentEvent("stripe", paidEvent(order.id, { type: "checkout.expired", paid: false }));
    expect((await getOrderById(order.id))?.status).toBe("expired");
  });

  it("handles a refund initiated from the provider dashboard", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });

    await applyPaymentEvent("stripe", paidEvent(order.id, { type: "refund.succeeded", paid: false }));

    const updated = await getOrderById(order.id);
    expect(updated?.status).toBe("refunded");
    expect(updated?.refunded_at).not.toBeNull();
  });

  it("acknowledges a late event without changing an order that moved on", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await transitionOrder(order.id, "paid", { paidAt: new Date() });
    await transitionOrder(order.id, "consented", { consentedAt: new Date() });

    const outcome = await applyPaymentEvent("stripe", paidEvent(order.id));
    expect(outcome.handled).toBe(true);
    expect((await getOrderById(order.id))?.status).toBe("consented");
  });

  it("ignores an event with no order attached", async () => {
    const outcome = await applyPaymentEvent("stripe", paidEvent("", { orderId: null, checkoutSessionId: null }));
    expect(outcome.handled).toBe(false);
    expect(outcome.action).toBe("ignored");
  });
});

describe("webhook signature verification", () => {
  it("accepts a correctly signed demo webhook", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.completed", order_id: "x", paid: true });
    const event = await mockPaymentProvider.verifyWebhook(body, signMockWebhook(body));
    expect(event.paid).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.completed", order_id: "x", paid: true });
    const signature = signMockWebhook(body);
    const tampered = JSON.stringify({ id: "evt_1", type: "checkout.completed", order_id: "y", paid: true });

    await expect(mockPaymentProvider.verifyWebhook(tampered, signature)).rejects.toThrow(PaymentProviderError);
  });

  it("rejects a missing or malformed signature", async () => {
    const body = "{}";
    await expect(mockPaymentProvider.verifyWebhook(body, null)).rejects.toThrow(/signature/i);
    await expect(mockPaymentProvider.verifyWebhook(body, "garbage")).rejects.toThrow(/signature/i);
    await expect(mockPaymentProvider.verifyWebhook(body, "demo,v1=00")).rejects.toThrow(/signature/i);
  });
});

describe("Stripe event normalisation", () => {
  it("treats a completed-but-unpaid session as unpaid", () => {
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          payment_status: "unpaid",
          amount_total: 599,
          metadata: { order_id: "order-1" },
          payment_intent: "pi_1",
        },
      },
    } as unknown as Stripe.Event;

    const normalized = normalizeStripeEvent(event);
    expect(normalized.type).toBe("checkout.completed");
    expect(normalized.paid).toBe(false);
  });

  it("treats a paid session as paid and carries the ids through", () => {
    const event = {
      id: "evt_2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2",
          payment_status: "paid",
          amount_total: 599,
          metadata: { order_id: "order-2" },
          payment_intent: { id: "pi_2" },
        },
      },
    } as unknown as Stripe.Event;

    const normalized = normalizeStripeEvent(event);
    expect(normalized.paid).toBe(true);
    expect(normalized.orderId).toBe("order-2");
    expect(normalized.paymentIntentId).toBe("pi_2");
    expect(normalized.amountTotalCents).toBe(599);
  });

  it("ignores event types it does not handle", () => {
    const event = { id: "evt_3", type: "customer.created", data: { object: {} } } as unknown as Stripe.Event;
    expect(normalizeStripeEvent(event).type).toBe("ignored");
  });
});

describe("housekeeping", () => {
  it("expires orders abandoned before payment", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await query("UPDATE orders SET created_at = now() - interval '3 hours' WHERE id = $1", [order.id]);

    const count = await expireAbandonedOrders(60);
    expect(count).toBeGreaterThanOrEqual(1);
    expect((await getOrderById(order.id))?.status).toBe("expired");
  });

  it("leaves a recent unpaid order alone", async () => {
    const order = await freshOrder();
    await transitionOrder(order.id, "payment_pending");
    await expireAbandonedOrders(60);
    expect((await getOrderById(order.id))?.status).toBe("payment_pending");
  });
});
