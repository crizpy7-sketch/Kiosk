import "server-only";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { getEnv } from "@/lib/env";
import { getStorage } from "@/lib/storage/index.server";
import { createAsset, getLatestAssetForOrder, getSetting, rotateAssetToken } from "@/lib/db/repositories";
import { createDeliveryToken, deliveryUrl, expiryFromNow, hoursUntil } from "@/lib/delivery/tokens";
import type { AssetRow, OrderRow } from "@/lib/db/types";
import { log } from "@/lib/log";

/**
 * Delivery: store the approved image privately, mint an unguessable link, and
 * render the QR the customer scans.
 *
 * The QR is generated server-side into a data URI — no CDN script, no third
 * party ever sees the delivery URL, and the CSP stays tight.
 */

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface DeliveryResult {
  assetId: string;
  downloadUrl: string;
  qrDataUri: string;
  expiresAt: Date;
  expiresInHours: number;
}

export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType);
}

export function isAllowedImageSize(byteSize: number): boolean {
  return byteSize > 0 && byteSize <= MAX_IMAGE_BYTES;
}

/**
 * The link lifetime actually applied to a new link.
 *
 * The owner can change this from the admin, so the stored setting wins over the
 * environment default. It is clamped to the same 1–168 hour range the admin
 * form enforces, because a bad value here would either leak photos indefinitely
 * or expire them before the customer walks out of the shop.
 */
export async function resolveTtlHours(): Promise<number> {
  const configured = await getSetting<number>("download_ttl_hours", getEnv().DOWNLOAD_LINK_TTL_HOURS);
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) return getEnv().DOWNLOAD_LINK_TTL_HOURS;
  return Math.min(168, Math.max(1, Math.round(parsed)));
}

/**
 * Object keys are built entirely from server-side values — a UUID and the
 * order id. Nothing derived from a client-supplied filename is used, so there is
 * no path to traverse and no customer detail encoded in the key.
 */
function storagePathFor(order: OrderRow): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `orders/${stamp}/${order.id}/${randomUUID()}.jpg`;
}

export async function renderQrDataUri(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 640,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

export async function storeFinalImage(
  order: OrderRow,
  body: Buffer,
  contentType: string,
): Promise<DeliveryResult> {
  const env = getEnv();
  const path = storagePathFor(order);

  const stored = await getStorage().put(path, body, contentType);
  const { token, tokenHash } = createDeliveryToken();
  const expiresAt = expiryFromNow(await resolveTtlHours());

  const asset = await createAsset({
    orderId: order.id,
    privateStoragePath: stored.path,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
    downloadTokenHash: tokenHash,
    expiresAt,
  });

  const downloadUrl = deliveryUrl(env.APP_BASE_URL, token);

  log.info("delivery.asset_stored", {
    orderId: order.id,
    assetId: asset.id,
    byteSize: stored.byteSize,
    expiresAt: expiresAt.toISOString(),
  });

  return {
    assetId: asset.id,
    downloadUrl,
    qrDataUri: await renderQrDataUri(downloadUrl),
    expiresAt,
    expiresInHours: hoursUntil(expiresAt),
  };
}

/**
 * Issues a fresh link for an existing asset — the staff "regenerate QR" action,
 * for a customer whose phone failed to scan or whose link expired.
 *
 * Rotating the token invalidates the previous one. That is deliberate: a link
 * that was shown on a screen in a shop should stop working once it is reissued.
 */
export async function regenerateDelivery(order: OrderRow): Promise<DeliveryResult | null> {
  const asset = await getLatestAssetForOrder(order.id);
  if (!asset) return null;

  const env = getEnv();
  const { token, tokenHash } = createDeliveryToken();
  const expiresAt = expiryFromNow(await resolveTtlHours());

  await rotateAssetToken(asset.id, tokenHash, expiresAt);
  const downloadUrl = deliveryUrl(env.APP_BASE_URL, token);

  log.info("delivery.link_regenerated", { orderId: order.id, assetId: asset.id });

  return {
    assetId: asset.id,
    downloadUrl,
    qrDataUri: await renderQrDataUri(downloadUrl),
    expiresAt,
    expiresInHours: hoursUntil(expiresAt),
  };
}

export type { AssetRow };
