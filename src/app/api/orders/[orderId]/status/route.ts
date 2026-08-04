import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { getOrderById } from "@/lib/orders/repository";
import { mayRetake } from "@/lib/orders/state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled by the kiosk after returning from checkout, until the webhook lands.
 *
 * Returns only what the kiosk needs to advance its own screen — never the Stripe
 * ids, never the payment intent, never anything a bystander could act on.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  try {
    const limit = rateLimit(clientKey(request, "order-status"), 120, 60);
    if (!limit.allowed) {
      return fail(429, "RATE_LIMITED", "Too many requests.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) {
      return fail(400, "INVALID_REQUEST", "That request wasn't valid.");
    }

    const order = await getOrderById(orderId);
    if (!order) return fail(404, "ORDER_NOT_FOUND", "We couldn't find that order.");

    return ok({
      orderId: order.id,
      status: order.status,
      publicReference: order.public_reference,
      retakeUsed: order.retake_used,
      canRetake: mayRetake(order.status, order.retake_used),
      errorCode: order.error_code,
    });
  } catch (error) {
    return handleApiError("GET /api/orders/[orderId]/status", error);
  }
}
