import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { getOrderById, markRetakeUsed, transitionOrder } from "@/lib/orders/repository";
import { mayRequestAiSession, mayRetake } from "@/lib/orders/state-machine";
import { findExperienceById } from "@/lib/config/experiences";
import { getAiSecondsUsedToday, getKiosk, startGenerationSession } from "@/lib/db/repositories";
import { getAiProvider } from "@/lib/ai/index.server";
import { recordAudit } from "@/lib/audit";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.uuid(),
  retake: z.boolean().default(false),
});

/**
 * Mints a short-lived AI client token — the single most sensitive route here.
 *
 * Every gate an unpaid or replaying client has to get through, in order:
 *
 *   1. Rate limit.
 *   2. The order exists.
 *   3. `mayRequestAiSession(status)` — only `generation_authorized` or
 *      `captured` qualify, which is reachable only via paid → consented.
 *   4. Retakes: `mayRetake` rejects a second one, and `retake_used` is set
 *      *before* the token is minted so a double-tap cannot win a race.
 *   5. The kiosk's daily AI seconds budget.
 *   6. Only then does the permanent Decart key get used, server-side, to mint a
 *      token pinned to one model, one origin, a short expiry and a hard session
 *      cap that Decart itself enforces.
 *
 * The response carries no account credential, and the prompt it returns is the
 * server's, resolved from the order's experience — the browser cannot ask for
 * a different style than the one it paid for.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Same reasoning as /api/checkout: one kiosk, one IP. The real protections
    // against credit burn are the order-state gate, the one-retake rule and the
    // kiosk's daily seconds budget, all enforced below.
    const limit = rateLimit(clientKey(request, "ai-session"), 20, 60);
    if (!limit.allowed) {
      return fail(429, "RATE_LIMITED", "Too many attempts. Please wait a moment.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "INVALID_REQUEST", "That request wasn't valid.");

    const env = getEnv();
    const { orderId, retake } = parsed.data;

    const order = await getOrderById(orderId);
    if (!order) return fail(404, "ORDER_NOT_FOUND", "We couldn't find that order.");

    // Gate 1: only a paid, consented order that the server itself authorized.
    if (!mayRequestAiSession(order.status)) {
      log.warn("ai.session_denied", { orderId, status: order.status });
      return fail(403, "NOT_AUTHORIZED", "This session isn't authorized.");
    }

    // Gate 2: at most one retake, ever.
    if (retake) {
      if (!mayRetake(order.status, order.retake_used)) {
        return fail(409, "RETAKE_NOT_ALLOWED", "You've already used your one retake.");
      }
      // Claimed before the token is minted: a duplicate request finds it used.
      await markRetakeUsed(orderId);
    } else if (order.status === "captured") {
      return fail(409, "ALREADY_CAPTURED", "This session already has a photo.");
    }

    const experience = findExperienceById(order.experience_id);
    if (!experience) return fail(409, "EXPERIENCE_NOT_FOUND", "That style is unavailable.");

    // Gate 3: the kiosk's daily AI budget. Protects the owner from a runaway bill.
    const kiosk = await getKiosk(order.kiosk_id);
    const usedToday = await getAiSecondsUsedToday(order.kiosk_id);
    const dailyLimit = kiosk?.daily_ai_limit_seconds ?? 3600;
    if (usedToday >= dailyLimit) {
      log.warn("ai.daily_limit_reached", { kioskId: order.kiosk_id, usedToday, dailyLimit });
      await recordAudit({
        orderId,
        kioskId: order.kiosk_id,
        actorLabel: "system",
        eventType: "ai.daily_limit_reached",
        metadata: { usedToday, dailyLimit },
      });
      return fail(429, "DAILY_LIMIT_REACHED", "The kiosk has reached today's limit. Please ask a team member.");
    }

    const maxSessionSeconds = Math.min(env.SESSION_MAX_SECONDS, experience.maxGenerationSeconds);

    // Move to `generating` first. If token minting then fails, the order is in a
    // state staff can see and recover from, rather than silently stuck.
    await transitionOrder(orderId, "generating", {
      generationStartedAt: new Date(),
      actorLabel: "kiosk",
      auditMetadata: { retake, model: experience.modelPreference },
    });

    const provider = getAiProvider();
    const generationSession = await startGenerationSession({
      orderId,
      provider: provider.name,
      model: experience.modelPreference,
      isRetake: retake,
    });

    const grant = await provider.createClientSession({
      experience,
      maxSessionSeconds,
      allowedOrigin: new URL(env.APP_BASE_URL).origin,
      reference: order.public_reference,
    });

    log.info("ai.session_created", {
      orderId,
      generationSessionId: generationSession.id,
      provider: provider.name,
      model: grant.model,
      maxSessionSeconds,
      retake,
    });

    return ok({
      ...grant,
      generationSessionId: generationSession.id,
      countdownSeconds: env.COUNTDOWN_SECONDS,
    });
  } catch (error) {
    return handleApiError("POST /api/ai/session", error);
  }
}
