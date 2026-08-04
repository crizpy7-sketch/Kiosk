import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { signMockWebhook } from "@/lib/payments/mock.server";
import { getPaymentProvider } from "@/lib/payments/index.server";
import { applyPaymentEvent } from "@/lib/orders/fulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(120),
  orderId: z.uuid(),
  amountCents: z.number().int().min(1).max(100_000),
  outcome: z.enum(["paid", "failed"]),
});

/**
 * Signs and applies a demo payment event.
 *
 * Exists so APP_SECRET stays on the server — the demo checkout page cannot sign
 * its own webhook. It is a 404 unless DEMO_MODE is on, and the event still goes
 * through signature verification and the same fulfilment path as a live Stripe
 * delivery, dedupe included.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const env = getEnv();
    if (!env.DEMO_MODE) return fail(404, "NOT_FOUND", "Not found.");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "INVALID_REQUEST", "That request wasn't valid.");

    const { sessionId, orderId, amountCents, outcome } = parsed.data;

    const payload = JSON.stringify({
      id: `evt_demo_${randomUUID().replace(/-/g, "")}`,
      type: outcome === "paid" ? "checkout.completed" : "payment.failed",
      order_id: orderId,
      checkout_session_id: sessionId,
      amount_total: amountCents,
      paid: outcome === "paid",
    });

    const provider = getPaymentProvider();
    const event = await provider.verifyWebhook(payload, signMockWebhook(payload));
    const result = await applyPaymentEvent(provider.name, event);

    return ok({ applied: result.handled, duplicate: result.duplicate });
  } catch (error) {
    return handleApiError("POST /api/demo/settle", error);
  }
}
