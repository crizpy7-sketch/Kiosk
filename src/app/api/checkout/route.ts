import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { getPaymentProvider } from "@/lib/payments/index.server";
import { getOrderById, transitionOrder } from "@/lib/orders/repository";
import { getResolvedExperience } from "@/lib/db/repositories";
import { findExperienceById } from "@/lib/config/experiences";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ orderId: z.uuid() });

/**
 * Creates a payment session for an order and returns the URL to redirect to.
 *
 * Only an order still in `created` may be checked out; a re-tap on the Pay
 * button after the first session was created loses the compare-and-set in
 * transitionOrder and returns 409 rather than opening a second charge.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // The whole kiosk is one IP, so this ceiling has to clear a genuinely busy
    // hour at the boutique while still stopping a script from farming Checkout
    // Sessions. Duplicate charges are prevented structurally instead — by the
    // `created -> payment_pending` compare-and-set below and Stripe's own
    // idempotency key — so this is an outer wall, not the real guard.
    const limit = rateLimit(clientKey(request, "checkout"), 30, 60);
    if (!limit.allowed) {
      return fail(429, "RATE_LIMITED", "Too many attempts. Please wait a moment.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "INVALID_REQUEST", "That request wasn't valid.");

    const env = getEnv();
    const order = await getOrderById(parsed.data.orderId);
    if (!order) return fail(404, "ORDER_NOT_FOUND", "We couldn't find that order.");
    if (order.status !== "created") {
      return fail(409, "ORDER_NOT_CHECKOUTABLE", "This order has already moved on.");
    }

    const experience = findExperienceById(order.experience_id);
    const resolved = await getResolvedExperience(experience?.slug ?? "");
    if (!experience || !resolved) return fail(409, "EXPERIENCE_NOT_FOUND", "That style is unavailable.");

    const provider = getPaymentProvider();
    const successUrl = new URL(`/kiosk/return?order=${order.id}&result=success`, env.APP_BASE_URL).toString();
    const cancelUrl = new URL(`/kiosk/return?order=${order.id}&result=cancel`, env.APP_BASE_URL).toString();

    const session = await provider.createCheckoutSession({
      orderId: order.id,
      publicReference: order.public_reference,
      experienceSlug: experience.slug,
      experienceName: experience.name.en,
      // Server-side price. The browser never gets a say in what is charged.
      priceCents: order.price_cents,
      currency: order.currency,
      language: order.language,
      successUrl,
      cancelUrl,
    });

    await transitionOrder(order.id, "payment_pending", {
      stripeCheckoutSessionId: session.id,
      actorLabel: "kiosk",
      auditMetadata: { provider: provider.name },
    });

    await recordAudit({
      orderId: order.id,
      kioskId: order.kiosk_id,
      actorLabel: "kiosk",
      eventType: "checkout.created",
      metadata: { provider: provider.name, priceCents: order.price_cents },
    });

    return ok({ checkoutUrl: session.url, sessionId: session.id, demo: provider.isMock });
  } catch (error) {
    return handleApiError("POST /api/checkout", error);
  }
}
