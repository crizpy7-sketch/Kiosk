import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { endGenerationSession } from "@/lib/db/repositories";
import { queryOne } from "@/lib/db/client";
import type { GenerationSessionRow } from "@/lib/db/types";
import { failOrder, getOrderById, transitionOrder } from "@/lib/orders/repository";
import { AI_ERROR_CODES } from "@/lib/ai/provider";
import { recordAudit } from "@/lib/audit";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Covers WebRTC setup between `started_at` and the first billed second. */
const HANDSHAKE_GRACE_SECONDS = 20;

/** Absolute ceiling regardless of elapsed time — no session may bill more. */
const MAX_BILLABLE_SECONDS = 120;

const bodySchema = z.object({
  status: z.enum(["completed", "failed", "timeout", "canceled"]),
  billableSeconds: z.number().min(0).max(600),
  providerSessionId: z.string().max(200).nullish(),
  errorCode: z.enum(AI_ERROR_CODES).nullish(),
});

/**
 * Closes out a generation session and books the usage.
 *
 * Called by the browser when the realtime session ends for any reason, and by
 * `navigator.sendBeacon` on unload so a customer walking away still books the
 * seconds we were billed for. It is therefore idempotent: `endGenerationSession`
 * only updates rows where `ended_at IS NULL`.
 *
 * A `failed` or `timeout` result moves the order to `failed`, which is what puts
 * it on the admin failures list with a refund button next to it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  try {
    const { sessionId } = await context.params;
    if (!z.uuid().safeParse(sessionId).success) {
      return fail(400, "INVALID_REQUEST", "That request wasn't valid.");
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "INVALID_REQUEST", "That request wasn't valid.");

    const session = await queryOne<GenerationSessionRow>(
      `SELECT * FROM generation_sessions WHERE id = $1`,
      [sessionId],
    );
    if (!session) return fail(404, "SESSION_NOT_FOUND", "We couldn't find that session.");

    const { status, billableSeconds, providerSessionId, errorCode } = parsed.data;

    // The browser reports what the provider billed it, but the browser is
    // untrusted in both directions: under-reporting would let a tampered client
    // burn Decart credits with the kiosk's daily budget never engaging, and
    // over-reporting would let six paid sessions exhaust the day's cap and shut
    // the kiosk to every later customer. Clamp to what the server itself
    // observed — the wall time since `started_at`, plus a small handshake grace,
    // and never more than a session is allowed to run.
    const elapsedSeconds = (Date.now() - session.started_at.getTime()) / 1000;
    const ceiling = Math.min(elapsedSeconds + HANDSHAKE_GRACE_SECONDS, MAX_BILLABLE_SECONDS);
    const clampedSeconds = Math.max(0, Math.min(billableSeconds, ceiling));

    if (clampedSeconds !== billableSeconds) {
      log.warn("ai.billable_seconds_clamped", { sessionId, reported: billableSeconds, clamped: clampedSeconds });
    }

    await endGenerationSession(sessionId, {
      status,
      billableSeconds: clampedSeconds,
      normalizedErrorCode: errorCode ?? null,
      providerSessionId: providerSessionId ?? null,
    });

    const order = await getOrderById(session.order_id);
    if (order) {
      if (status === "failed" || status === "timeout") {
        await failOrder(order.id, errorCode ?? "AI_UNKNOWN", {
          actorLabel: "kiosk",
          metadata: { generationSessionId: sessionId, status },
        });
      } else if (status === "canceled" && order.status === "generating") {
        await transitionOrder(order.id, "failed", {
          failedAt: new Date(),
          errorCode: "AI_CANCELED",
          actorLabel: "kiosk",
        }).catch(() => undefined);
      }

      await recordAudit({
        orderId: order.id,
        kioskId: order.kiosk_id,
        actorLabel: "kiosk",
        eventType: `ai.session_${status}`,
        metadata: { generationSessionId: sessionId, billableSeconds: clampedSeconds, errorCode: errorCode ?? null },
      });
    }

    log.info("ai.session_ended", { sessionId, status, billableSeconds: clampedSeconds, errorCode: errorCode ?? null });

    return ok({ recorded: true });
  } catch (error) {
    return handleApiError("POST /api/ai/session/[sessionId]/end", error);
  }
}
