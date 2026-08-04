import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { getResolvedExperience } from "@/lib/db/repositories";
import { createOrder } from "@/lib/orders/repository";
import { LANGUAGES } from "@/lib/i18n/messages";
import { isDemoMode } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  experienceSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  language: z.enum(LANGUAGES),
});

/**
 * Opens an order for the selected style.
 *
 * The price is read from the server-side experience record, never from the
 * request. The client sends a slug and a language; everything else that matters
 * is decided here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const limit = rateLimit(clientKey(request, "orders"), 20, 60);
    if (!limit.allowed) {
      return fail(429, "RATE_LIMITED", "Too many requests. Please wait a moment.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "INVALID_REQUEST", "That request wasn't valid.");

    const env = getEnv();
    const experience = await getResolvedExperience(parsed.data.experienceSlug);
    if (!experience) return fail(404, "EXPERIENCE_NOT_FOUND", "That style isn't available.");
    if (!experience.active) return fail(409, "EXPERIENCE_INACTIVE", "That style is unavailable right now.");

    const order = await createOrder({
      kioskId: env.KIOSK_ID,
      experienceId: experience.id,
      language: parsed.data.language,
      priceCents: experience.priceCents,
      demo: isDemoMode(),
    });

    return ok({
      orderId: order.id,
      publicReference: order.public_reference,
      status: order.status,
      priceCents: order.price_cents,
      currency: order.currency,
    });
  } catch (error) {
    return handleApiError("POST /api/orders", error);
  }
}
