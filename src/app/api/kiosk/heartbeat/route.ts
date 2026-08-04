import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { handleApiError, ok } from "@/lib/api/respond";
import { recordKioskHeartbeat } from "@/lib/db/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  batteryPercent: z.number().int().min(0).max(100).nullish(),
  batteryCharging: z.boolean().nullish(),
  appVersion: z.string().max(40).nullish(),
});

/**
 * Kiosk liveness and battery telemetry, posted every 30s while the kiosk is open.
 *
 * The kiosk id comes from server configuration, not the request body — a stray
 * POST cannot mark someone else's kiosk online. Battery is best-effort: the
 * Battery Status API is unavailable in Safari, so the admin shows "unknown"
 * rather than a fabricated number.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    const beat = parsed.success ? parsed.data : {};

    await recordKioskHeartbeat(getEnv().KIOSK_ID, {
      batteryPercent: beat.batteryPercent ?? null,
      batteryCharging: beat.batteryCharging ?? null,
      appVersion: beat.appVersion ?? undefined,
    });

    return ok({ received: true });
  } catch (error) {
    return handleApiError("POST /api/kiosk/heartbeat", error);
  }
}
