import "server-only";
import { query } from "@/lib/db/client";
import type { AuditEventRow } from "@/lib/db/types";

/**
 * Keys that must never land in an audit row. The audit log is read by staff in
 * the admin UI and copied into support threads; a secret that reaches it is a
 * secret in a screenshot.
 */
const REDACT_KEYS = [
  "apikey",
  "api_key",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "client_secret",
  "signature",
  "email",
  "phone",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEYS.some((needle) => lower.includes(needle));
}

/**
 * Strips secrets and truncates strings before anything is persisted.
 * Applied recursively so a nested provider error payload can't smuggle a key in.
 */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return null;

  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? "[redacted]" : sanitizeMetadata(item, depth + 1);
    }
    return out;
  }

  return "[unserializable]";
}

export interface AuditInput {
  actorUserId?: string | null;
  actorLabel?: string;
  kioskId?: string | null;
  orderId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const safe = sanitizeMetadata(input.metadata ?? {}) as Record<string, unknown>;
  await query(
    `INSERT INTO audit_events (actor_user_id, actor_label, kiosk_id, order_id, event_type, safe_metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.actorUserId ?? null,
      input.actorLabel ?? "system",
      input.kioskId ?? null,
      input.orderId ?? null,
      input.eventType,
      JSON.stringify(safe),
    ],
  );
}

export async function listAuditEvents(limit = 100, orderId?: string): Promise<AuditEventRow[]> {
  if (orderId) {
    return query<AuditEventRow>(
      `SELECT * FROM audit_events WHERE order_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [orderId, Math.min(limit, 500)],
    );
  }
  return query<AuditEventRow>(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1`, [
    Math.min(limit, 500),
  ]);
}
