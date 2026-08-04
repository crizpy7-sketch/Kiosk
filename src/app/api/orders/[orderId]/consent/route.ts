import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { getOrderById, transitionOrder } from "@/lib/orders/repository";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ agreed: z.literal(true) });

/**
 * Records consent. `paid -> consented` only, so consent cannot be recorded for
 * an unpaid order and cannot be replayed to unlock a second session.
 *
 * We store the fact and the time, not a signature, a name, or an IP — the least
 * data that still demonstrates the customer saw and accepted the notice.
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

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "CONSENT_REQUIRED", "Consent is required to continue.");

    const order = await getOrderById(orderId);
    if (!order) return fail(404, "ORDER_NOT_FOUND", "We couldn't find that order.");
    if (order.status !== "paid") {
      return fail(409, "NOT_PAID", "This order isn't ready for consent yet.");
    }

    await transitionOrder(orderId, "consented", {
      consentedAt: new Date(),
      actorLabel: "kiosk",
      auditMetadata: { consentVersion: "v1", language: order.language },
    });

    // Consent is the last precondition, so the server authorizes generation in
    // the same request. Keeping `generation_authorized` as its own state (rather
    // than letting /api/ai/session accept `consented` directly) means the gate
    // that mints AI tokens tests one status and one status only — there is no
    // second path into it to review, and no way to reach it without paying.
    const updated = await transitionOrder(orderId, "generation_authorized", {
      actorLabel: "system",
      auditMetadata: { reason: "consent_recorded" },
    });

    await recordAudit({
      orderId,
      kioskId: order.kiosk_id,
      actorLabel: "kiosk",
      eventType: "consent.recorded",
      metadata: { consentVersion: "v1", language: order.language },
    });

    return ok({ status: updated.status });
  } catch (error) {
    return handleApiError("POST /api/orders/[orderId]/consent", error);
  }
}
