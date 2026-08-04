import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { listExpiredAssets, markAssetDeleted } from "@/lib/db/repositories";
import { getStorage } from "@/lib/storage/index.server";
import { recordAudit } from "@/lib/audit";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled deletion of expired photos.
 *
 * This is what makes "your photo is deleted after 24 hours" true rather than
 * aspirational. It exists as an HTTP route as well as a CLI script
 * (`npm run jobs:expire`) because serverless hosts schedule work by hitting a
 * URL — and a retention promise that depends on someone remembering to run a
 * script by hand is not a retention promise.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without
 * that variable the route refuses in production rather than exposing an
 * unauthenticated endpoint. It only ever touches assets that have *already*
 * expired, so even a successful unauthorised call destroys nothing still valid —
 * but it should not be free to trigger either.
 */
async function runExpiry(request: Request): Promise<NextResponse> {
  try {
    const env = getEnv();
    const secret = process.env["CRON_SECRET"];

    if (env.NODE_ENV === "production") {
      if (!secret) {
        log.error("jobs.expire.not_configured");
        return fail(500, "NOT_CONFIGURED", "This job is not configured.");
      }
      const provided = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
      const expected = Buffer.from(secret);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        return fail(401, "UNAUTHORIZED", "Not authorized.");
      }
    }

    const storage = getStorage();
    let deleted = 0;
    let failed = 0;

    for (;;) {
      const batch = await listExpiredAssets(100);
      if (batch.length === 0) break;

      for (const asset of batch) {
        try {
          // Bytes first, tombstone second: a crash between them leaves a
          // retryable state, never a row claiming a deletion that didn't happen.
          await storage.delete(asset.private_storage_path);
          await markAssetDeleted(asset.id);
          await recordAudit({
            orderId: asset.order_id,
            actorLabel: "expiry-job",
            eventType: "asset.expired_deleted",
            metadata: { assetId: asset.id, expiredAt: asset.expires_at.toISOString() },
          });
          deleted += 1;
        } catch (error) {
          failed += 1;
          log.error("jobs.expire.delete_failed", { assetId: asset.id, error });
        }
      }

      if (batch.length < 100) break;
    }

    log.info("jobs.expire.completed", { deleted, failed });
    return ok({ deleted, failed });
  } catch (error) {
    return handleApiError("POST /api/jobs/expire-assets", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return runExpiry(request);
}

/** Vercel Cron issues GET; same work, same guard. */
export async function GET(request: Request): Promise<NextResponse> {
  return runExpiry(request);
}
