import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { getOrderById, transitionOrder } from "@/lib/orders/repository";
import { isAllowedImageSize, isAllowedImageType, storeFinalImage } from "@/lib/delivery/service";
import { recordAudit } from "@/lib/audit";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Accepts the one approved final image and returns the QR delivery.
 *
 * Only reachable from `captured` — that is, after the customer pressed
 * "I LOVE IT" on a frame from a paid, consented session. What arrives here is
 * the transformed result the customer chose; raw camera frames never leave the
 * browser and are never written anywhere.
 *
 * Uploads are validated on content, not on the filename: the client-supplied
 * name is discarded entirely and the storage key is built from server values.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  try {
    const limit = rateLimit(clientKey(request, "capture"), 20, 60);
    if (!limit.allowed) {
      return fail(429, "RATE_LIMITED", "Too many uploads. Please wait a moment.", {
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) {
      return fail(400, "INVALID_REQUEST", "That request wasn't valid.");
    }

    const order = await getOrderById(orderId);
    if (!order) return fail(404, "ORDER_NOT_FOUND", "We couldn't find that order.");
    if (order.status !== "captured") {
      return fail(409, "NOT_CAPTURED", "This order isn't ready for delivery.");
    }

    // Content-Length is a hint, not a guarantee — a chunked request has none,
    // so trusting it alone lets an unbounded body reach formData() and get
    // buffered whole. Reject the obvious case here, then enforce the real limit
    // by counting bytes off the stream below.
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_UPLOAD_BYTES) {
      return fail(413, "IMAGE_TOO_LARGE", "That image is too large.");
    }

    const bounded = await readBounded(request, MAX_UPLOAD_BYTES);
    if (bounded === null) return fail(413, "IMAGE_TOO_LARGE", "That image is too large.");

    // Re-wrap the bounded bytes so formData() parses a body we have already
    // proven is within limits.
    const form = await new Response(new Blob([bounded]), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    })
      .formData()
      .catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File)) return fail(400, "IMAGE_REQUIRED", "No image was received.");

    if (!isAllowedImageType(file.type)) {
      return fail(415, "UNSUPPORTED_IMAGE_TYPE", "That image format isn't supported.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isAllowedImageSize(buffer.byteLength)) {
      return fail(413, "IMAGE_TOO_LARGE", "That image is too large.");
    }
    if (!looksLikeImage(buffer, file.type)) {
      return fail(415, "UNSUPPORTED_IMAGE_TYPE", "That file isn't a valid image.");
    }

    const delivery = await storeFinalImage(order, buffer, file.type);

    await transitionOrder(orderId, "completed", {
      generationCompletedAt: new Date(),
      actorLabel: "kiosk",
      auditMetadata: { assetId: delivery.assetId, byteSize: buffer.byteLength },
    });
    await transitionOrder(orderId, "delivered", {
      deliveredAt: new Date(),
      actorLabel: "kiosk",
      auditMetadata: { assetId: delivery.assetId },
    });

    await recordAudit({
      orderId,
      kioskId: order.kiosk_id,
      actorLabel: "kiosk",
      eventType: "delivery.created",
      metadata: { assetId: delivery.assetId, expiresAt: delivery.expiresAt.toISOString() },
    });

    log.info("capture.delivered", { orderId, assetId: delivery.assetId });

    return ok({
      qrDataUri: delivery.qrDataUri,
      downloadUrl: delivery.downloadUrl,
      expiresInHours: delivery.expiresInHours,
      expiresAt: delivery.expiresAt.toISOString(),
    });
  } catch (error) {
    return handleApiError("POST /api/orders/[orderId]/capture", error);
  }
}

/**
 * Reads the body with a hard ceiling, aborting as soon as it is exceeded.
 * Returns null when the body is too large, so nothing oversized is ever held in
 * memory in full.
 */
async function readBounded(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Magic-byte check. A declared Content-Type is just a claim; this makes sure we
 * are storing (and later serving) what we think we are.
 */
function looksLikeImage(buffer: Buffer, contentType: string): boolean {
  if (buffer.byteLength < 12) return false;

  if (contentType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    );
  }
  if (contentType === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}
