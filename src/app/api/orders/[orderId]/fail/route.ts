import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { failOrder, getOrderById } from "@/lib/orders/repository";
import { isPaid } from "@/lib/orders/state-machine";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  errorCode: z.string().min(1).max(60).regex(/^[A-Z0-9_]+$/),
});

/**
 * The kiosk reporting that a paid session died on its side.
 *
 * Without this, a failure that happens *before* an AI session exists — the
 * token request 502s, the camera dies after consent, the network drops — leaves
 * the order sitting in `generation_authorized` forever. The customer sees the
 * right apology, but the order never surfaces on the admin's failures list, so
 * nobody knows to refund them. That is the exact scenario the brief calls out:
 * payment succeeded, generation did not, staff must be able to find it.
 *
 * Only post-payment orders can be failed through here, so this cannot be used
 * to churn or poison orders that were never charged.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  try {
    const limit = rateLimit(clientKey(request, "order-fail"), 20, 60);
    if (!limit.allowed) {
      return fail(429, "RATE_LIMITED", "Too many requests.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) {
      return fail(400, "INVALID_REQUEST", "That request wasn't valid.");
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "INVALID_REQUEST", "That request wasn't valid.");

    const order = await getOrderById(orderId);
    if (!order) return fail(404, "ORDER_NOT_FOUND", "We couldn't find that order.");

    if (!isPaid(order.status)) {
      // Unpaid orders expire on their own; there is nothing for staff to rescue.
      return ok({ recorded: false, status: order.status });
    }

    const updated = await failOrder(orderId, parsed.data.errorCode, {
      actorLabel: "kiosk",
      metadata: { reportedBy: "kiosk" },
    });

    log.warn("order.kiosk_reported_failure", { orderId, errorCode: parsed.data.errorCode });

    return ok({ recorded: true, status: updated?.status ?? order.status });
  } catch (error) {
    return handleApiError("POST /api/orders/[orderId]/fail", error);
  }
}
