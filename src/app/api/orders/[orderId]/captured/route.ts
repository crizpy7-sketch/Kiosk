import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { getOrderById, transitionOrder } from "@/lib/orders/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marks that a frame was grabbed and the AI session is over — `generating ->
 * captured`. Separate from the upload because the customer has not approved the
 * image yet: at this point they are looking at the reveal screen deciding
 * between "I LOVE IT" and "RETAKE ONCE".
 *
 * Keeping these apart is what lets a retake be authorised (`captured ->
 * generating`) without any image ever having been uploaded.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  try {
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) {
      return fail(400, "INVALID_REQUEST", "That request wasn't valid.");
    }

    const order = await getOrderById(orderId);
    if (!order) return fail(404, "ORDER_NOT_FOUND", "We couldn't find that order.");
    if (order.status !== "generating") {
      return fail(409, "NOT_GENERATING", "This order isn't in a capture state.");
    }

    const updated = await transitionOrder(orderId, "captured", {
      generationCompletedAt: new Date(),
      actorLabel: "kiosk",
    });

    return ok({ status: updated.status, canRetake: !updated.retake_used });
  } catch (error) {
    return handleApiError("POST /api/orders/[orderId]/captured", error);
  }
}
