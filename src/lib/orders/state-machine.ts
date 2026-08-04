/**
 * Server-authoritative order lifecycle.
 *
 * The kiosk browser is untrusted: it can be reloaded, tampered with, or driven
 * by someone who never paid. Every transition that unlocks something valuable
 * (generation, delivery) is applied here, on the server, guarded by an explicit
 * allow-list. A transition that is not listed cannot happen.
 */

export const ORDER_STATUSES = [
  "created",
  "payment_pending",
  "paid",
  "consented",
  "generation_authorized",
  "generating",
  "captured",
  "completed",
  "delivered",
  "failed",
  "refund_pending",
  "refunded",
  "expired",
  "deleted",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed transitions. Read as: from -> [permitted next states].
 *
 * Notes on the deliberate shapes here:
 * - `paid` and everything after it can always fall to `failed`; a paid customer
 *   whose generation dies must land somewhere a staff member can refund from.
 * - `failed` can go to `generation_authorized` so staff can retry a paid order
 *   once, without a second charge.
 * - `generating` deliberately has NO self-transition. Allowing one made the
 *   compare-and-set a no-op for a concurrent retake, so two simultaneous
 *   requests could both mint an AI token against a single payment.
 * - `refund_pending` is reachable from every post-payment state including
 *   `delivered` — a refund request is a business decision, not a technical one.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ["payment_pending", "expired", "failed"],
  payment_pending: ["paid", "failed", "expired"],
  paid: ["consented", "refund_pending", "failed", "expired"],
  consented: ["generation_authorized", "refund_pending", "failed", "expired"],
  generation_authorized: ["generating", "refund_pending", "failed", "expired"],
  generating: ["captured", "refund_pending", "failed", "expired"],
  // `captured -> generating` is the single approved retake.
  captured: ["completed", "generating", "refund_pending", "failed", "expired"],
  completed: ["delivered", "refund_pending", "failed", "expired"],
  delivered: ["refund_pending", "expired"],
  failed: ["refund_pending", "generation_authorized", "expired", "deleted"],
  refund_pending: ["refunded", "failed"],
  refunded: ["deleted", "expired"],
  expired: ["deleted", "refund_pending"],
  deleted: [],
};

/** Statuses at or past payment — the customer's money is with us. */
const PAID_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "paid",
  "consented",
  "generation_authorized",
  "generating",
  "captured",
  "completed",
  "delivered",
  "refund_pending",
]);

/** Statuses from which no further customer-facing work happens. */
const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "refunded",
  "deleted",
]);

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Cannot move order from "${from}" to "${to}".`);
    this.name = "InvalidTransitionError";
  }
}

/** Throws unless `from -> to` is permitted. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** True once the customer has been charged and not yet refunded. */
export function isPaid(status: OrderStatus): boolean {
  return PAID_STATUSES.has(status);
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * The gate that protects Decart credits: an order may only obtain an AI client
 * token when payment cleared *and* consent was recorded *and* the server moved
 * it into an authorized state. A browser cannot talk its way past this.
 */
export function mayRequestAiSession(status: OrderStatus): boolean {
  return status === "generation_authorized" || status === "captured";
}

/**
 * Retakes are capped at one. The order row carries `retake_used`; this keeps the
 * rule in one place so the API route and the admin tools agree.
 */
export function mayRetake(status: OrderStatus, retakeUsed: boolean): boolean {
  return status === "captured" && !retakeUsed;
}

/** A refund is only meaningful for money we actually took. */
export function mayRefund(status: OrderStatus): boolean {
  return isPaid(status) || status === "failed" || status === "expired";
}
