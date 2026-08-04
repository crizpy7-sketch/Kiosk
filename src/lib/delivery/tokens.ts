import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Delivery tokens.
 *
 * The download URL is the only thing standing between a stranger and someone
 * else's photo, so it is a 256-bit random value — not an order id, not a
 * sequence, nothing guessable or enumerable. We store only its SHA-256, so a
 * database dump (or a support engineer reading rows) cannot reconstruct a
 * working link. Lookup is by hash, which is a constant-length exact match.
 */

const TOKEN_BYTES = 32;

export interface DeliveryToken {
  /** Goes into the QR code. Never persisted. */
  token: string;
  /** Persisted on the asset row. */
  tokenHash: string;
}

export function createDeliveryToken(): DeliveryToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashDeliveryToken(token) };
}

export function hashDeliveryToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Shape check before touching the database — cheap rejection of junk. */
export function isWellFormedDeliveryToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

export function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function deliveryUrl(baseUrl: string, token: string): string {
  return new URL(`/d/${token}`, baseUrl).toString();
}

/** Absolute expiry from a TTL in hours. */
export function expiryFromNow(ttlHours: number, now = new Date()): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

/** Whole hours remaining, floored at 0 — what the customer sees on the QR screen. */
export function hoursUntil(expiresAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000)));
}

export function isExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
