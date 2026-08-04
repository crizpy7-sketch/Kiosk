import "server-only";
import { randomBytes } from "node:crypto";
import { query, queryOne, transaction } from "@/lib/db/client";
import type { OrderRow } from "@/lib/db/types";
import { assertTransition, InvalidTransitionError, type OrderStatus } from "@/lib/orders/state-machine";
import type { Language } from "@/lib/i18n/messages";
import { recordAudit } from "@/lib/audit";

/** Unambiguous alphabet: no O/0, no I/1 — staff read these aloud over a counter. */
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePublicReference(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `WF-${out}`;
}

export interface CreateOrderInput {
  kioskId: string;
  experienceId: string;
  language: Language;
  priceCents: number;
  currency?: string;
  demo: boolean;
}

export async function createOrder(input: CreateOrderInput): Promise<OrderRow> {
  const row = await queryOne<OrderRow>(
    `INSERT INTO orders (public_reference, kiosk_id, experience_id, language, price_cents, currency, demo, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'created')
     RETURNING *`,
    [
      generatePublicReference(),
      input.kioskId,
      input.experienceId,
      input.language,
      input.priceCents,
      input.currency ?? "usd",
      input.demo,
    ],
  );
  if (!row) throw new Error("Failed to create order.");
  await recordAudit({
    orderId: row.id,
    kioskId: row.kiosk_id,
    actorLabel: "kiosk",
    eventType: "order.created",
    metadata: { experienceId: row.experience_id, priceCents: row.price_cents, demo: row.demo },
  });
  return row;
}

export async function getOrderById(id: string): Promise<OrderRow | null> {
  return queryOne<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [id]);
}

export async function getOrderByPublicReference(reference: string): Promise<OrderRow | null> {
  return queryOne<OrderRow>(`SELECT * FROM orders WHERE public_reference = $1`, [reference]);
}

export async function getOrderByCheckoutSessionId(sessionId: string): Promise<OrderRow | null> {
  return queryOne<OrderRow>(`SELECT * FROM orders WHERE stripe_checkout_session_id = $1`, [sessionId]);
}

/** Columns a transition is allowed to stamp alongside the status change. */
interface TransitionFields {
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  paidAt?: Date;
  consentedAt?: Date;
  generationStartedAt?: Date;
  generationCompletedAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  refundedAt?: Date;
  errorCode?: string | null;
  retakeUsed?: boolean;
}

const FIELD_COLUMNS: Record<keyof TransitionFields, string> = {
  stripeCheckoutSessionId: "stripe_checkout_session_id",
  stripePaymentIntentId: "stripe_payment_intent_id",
  paidAt: "paid_at",
  consentedAt: "consented_at",
  generationStartedAt: "generation_started_at",
  generationCompletedAt: "generation_completed_at",
  deliveredAt: "delivered_at",
  failedAt: "failed_at",
  refundedAt: "refunded_at",
  errorCode: "error_code",
  retakeUsed: "retake_used",
};

export interface TransitionOptions extends TransitionFields {
  actorLabel?: string;
  actorUserId?: string;
  auditMetadata?: Record<string, unknown>;
}

/**
 * Moves an order to `to`, atomically.
 *
 * The UPDATE carries `WHERE status = <observed status>`, so two concurrent
 * callers (a webhook retry and the kiosk polling, say) cannot both succeed. The
 * loser sees zero rows updated and gets an InvalidTransitionError describing the
 * status that actually won — which is exactly the signal a webhook handler needs
 * to treat the delivery as a duplicate and acknowledge it.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions = {},
): Promise<OrderRow> {
  const { actorLabel, actorUserId, auditMetadata, ...fields } = options;

  return transaction(async (client) => {
    const current = await client.query<OrderRow>(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = current.rows[0];
    if (!order) throw new Error(`Order ${orderId} not found.`);

    assertTransition(order.status, to);

    const setFragments: string[] = ["status = $2", "updated_at = now()"];
    const params: unknown[] = [orderId, to];

    for (const [key, value] of Object.entries(fields) as [keyof TransitionFields, unknown][]) {
      if (value === undefined) continue;
      params.push(value);
      setFragments.push(`${FIELD_COLUMNS[key]} = $${params.length}`);
    }

    const updated = await client.query<OrderRow>(
      `UPDATE orders SET ${setFragments.join(", ")}
       WHERE id = $1 AND status = $${params.length + 1}
       RETURNING *`,
      [...params, order.status],
    );

    const row = updated.rows[0];
    if (!row) {
      // Another transaction moved it between our SELECT and UPDATE.
      const latest = await client.query<OrderRow>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
      throw new InvalidTransitionError(latest.rows[0]?.status ?? order.status, to);
    }

    await client.query(
      `INSERT INTO audit_events (actor_user_id, actor_label, kiosk_id, order_id, event_type, safe_metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actorUserId ?? null,
        actorLabel ?? "system",
        row.kiosk_id,
        row.id,
        `order.${to}`,
        JSON.stringify({ from: order.status, to, ...(auditMetadata ?? {}) }),
      ],
    );

    return row;
  });
}

/**
 * Marks an order failed from wherever it is. Used by error paths that don't know
 * the current status and must not throw on top of an existing failure.
 */
export async function failOrder(
  orderId: string,
  errorCode: string,
  options: { actorLabel?: string; metadata?: Record<string, unknown> } = {},
): Promise<OrderRow | null> {
  try {
    return await transitionOrder(orderId, "failed", {
      failedAt: new Date(),
      errorCode,
      actorLabel: options.actorLabel ?? "system",
      auditMetadata: { errorCode, ...(options.metadata ?? {}) },
    });
  } catch (error) {
    if (error instanceof InvalidTransitionError) return getOrderById(orderId);
    throw error;
  }
}

export async function markRetakeUsed(orderId: string): Promise<void> {
  await query(`UPDATE orders SET retake_used = TRUE, updated_at = now() WHERE id = $1`, [orderId]);
}

export async function setStaffNote(orderId: string, note: string | null): Promise<void> {
  await query(`UPDATE orders SET staff_note = $2, updated_at = now() WHERE id = $1`, [orderId, note]);
}

export async function markHelped(orderId: string): Promise<void> {
  await query(`UPDATE orders SET helped_at = now(), updated_at = now() WHERE id = $1`, [orderId]);
}

export interface ListOrdersFilter {
  status?: OrderStatus[];
  kioskId?: string;
  since?: Date;
  limit?: number;
  offset?: number;
  search?: string;
}

export async function listOrders(filter: ListOrdersFilter = {}): Promise<OrderRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status?.length) {
    params.push(filter.status);
    conditions.push(`status = ANY($${params.length}::text[])`);
  }
  if (filter.kioskId) {
    params.push(filter.kioskId);
    conditions.push(`kiosk_id = $${params.length}`);
  }
  if (filter.since) {
    params.push(filter.since);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (filter.search) {
    params.push(filter.search.trim().toUpperCase());
    conditions.push(`public_reference = $${params.length}`);
  }

  params.push(Math.min(filter.limit ?? 50, 200));
  const limitPlaceholder = `$${params.length}`;
  params.push(filter.offset ?? 0);
  const offsetPlaceholder = `$${params.length}`;

  return query<OrderRow>(
    `SELECT * FROM orders
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    params,
  );
}

/** Expires stale orders that never reached payment — housekeeping, not deletion. */
export async function expireAbandonedOrders(olderThanMinutes = 60): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE orders
        SET status = 'expired', updated_at = now()
      WHERE status IN ('created', 'payment_pending')
        AND created_at < now() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(olderThanMinutes)],
  );
  return rows.length;
}
