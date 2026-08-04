import { NextResponse } from "next/server";
import { fail, handleApiError } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { getAssetByTokenHash, markAssetDownloaded } from "@/lib/db/repositories";
import { hashDeliveryToken, isExpired, isWellFormedDeliveryToken } from "@/lib/delivery/tokens";
import { getStorage } from "@/lib/storage/index.server";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only route that serves a customer's image bytes.
 *
 * Authorisation is possession of the token, so the checks are: shape, then hash
 * lookup, then expiry, then deletion. Expired and deleted assets return the same
 * 404 as an unknown token — a probe cannot distinguish "never existed" from
 * "expired an hour ago".
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const limit = rateLimit(clientKey(request, "download"), 60, 60);
    if (!limit.allowed) {
      return fail(429, "RATE_LIMITED", "Too many requests.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const { token } = await context.params;
    if (!isWellFormedDeliveryToken(token)) {
      return fail(404, "NOT_FOUND", "This link is no longer available.");
    }

    const asset = await getAssetByTokenHash(hashDeliveryToken(token));
    if (!asset || asset.deleted_at || isExpired(asset.expires_at)) {
      return fail(404, "NOT_FOUND", "This link is no longer available.");
    }

    const object = await getStorage().get(asset.private_storage_path);
    if (!object) {
      log.error("download.object_missing", { assetId: asset.id });
      return fail(404, "NOT_FOUND", "This link is no longer available.");
    }

    void markAssetDownloaded(asset.id).catch(() => undefined);

    return new NextResponse(new Uint8Array(object.body), {
      status: 200,
      headers: {
        "Content-Type": object.contentType,
        "Content-Length": String(object.body.byteLength),
        // Filename is fixed and server-generated — nothing from the request
        // reaches the header, so there is no injection surface here.
        "Content-Disposition": 'attachment; filename="wild-frame-ai.jpg"',
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        // Keep the token out of analytics on whatever the customer taps next.
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return handleApiError("GET /api/download/[token]", error);
  }
}
