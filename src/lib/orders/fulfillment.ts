import "server-only";
import { query, queryOne } from "@/lib/db/client";
import { log } from "@/lib/log";
import { recordAudit } from "@/lib/audit";
import type { PaymentEvent } from "@/lib/payments/provider";
import { getOrderByCheckoutSessionId, getOrderById, transitionOrder } from "@/lib/orders/repository";
import { InvalidTransitionError } from "@/lib/orders/state-machine";

/**
 * Webhook fulfilment.
 *
 * Two independent idempotency guards, because payment webhooks are delivered
 * at-least-once and a double fulfilment here means a customer gets two AI
 * sessions for one payment:
 *
 *   1. `webhook_events` has UNIQUE (provider, event_id). A duplicate delivery
 *      loses the INSERT and returns early — it never reaches the transition.
 *   2. The transition itself is a compare-and-set on the order's current status.
 *      Even if guard 1 were bypassed, `payment_pending -> paid` cannot run twice.
 */

export type FulfillmentOutcome =
  | { handled: true; duplicate: false; orderId: string | null; action: string }
  | { handled: true; duplicate: true; orderId: string | null; action: "duplicate" }
  | { handled: false; duplicate: false; orderId: string | null; action: "ignored" };

/**
 * Claims an event id. Returns false when this event was already recorded, which
 * is the signal to acknowledge the delivery without doing the work again.
 */
async function claimEvent(provider: string, event: PaymentEvent): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO webhook_events (provider, event_id, event_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [provider, event.eventId, event.type],
  );
  return row !== null;
}

async function markEventProcessed(provider: string, eventId: string): Promise<void> {
  await query(`UPDATE webhook_events SET processed_at = now() WHERE provider = $1 AND event_id = $2`, [
    provider,
    eventId,
  ]);
}

/** Resolves the order from event metadata, falling back to the session id. */
async function resolveOrderId(event: PaymentEvent): Promise<string | null> {
  if (event.orderId) return event.orderId;
  if (event.checkoutSessionId) {
    const order = await getOrderByCheckoutSessionId(event.checkoutSessionId);
    return order?.id ?? null;
  }
  return null;
}

export async function applyPaymentEvent(provider: string, event: PaymentEvent): Promise<FulfillmentOutcome> {
  if (event.type === "ignored") {
    return { handled: false, duplicate: false, orderId: null, action: "ignored" };
  }

  const claimed = await claimEvent(provider, event);
  const orderId = await resolveOrderId(event);

  if (!claimed) {
    log.info("webhook.duplicate", { provider, eventType: event.type, orderId });
    return { handled: true, duplicate: true, orderId, action: "duplicate" };
  }

  if (!orderId) {
    log.warn("webhook.no_order", { provider, eventType: event.type, eventId: event.eventId });
    await markEventProcessed(provider, event.eventId);
    return { handled: false, duplicate: false, orderId: null, action: "ignored" };
  }

  const order = await getOrderById(orderId);
  if (!order) {
    log.warn("webhook.unknown_order", { provider, orderId });
    await markEventProcessed(provider, event.eventId);
    return { handled: false, duplicate: false, orderId, action: "ignored" };
  }

  try {
    switch (event.type) {
      case "checkout.completed": {
        // A completed session is not necessarily a paid one — delayed payment
        // methods complete the session and settle later. Only `paid` unlocks.
        if (!event.paid) {
          log.info("webhook.completed_unpaid", { orderId, status: order.status });
          break;
        }

        // Guard against a tampered or mismatched session charging the wrong amount.
        if (event.amountTotalCents !== null && event.amountTotalCents !== order.price_cents) {
          log.error("webhook.amount_mismatch", {
            orderId,
            expected: order.price_cents,
            received: event.amountTotalCents,
          });
          await transitionOrder(orderId, "failed", {
            failedAt: new Date(),
            errorCode: "PAYMENT_AMOUNT_MISMATCH",
            actorLabel: "webhook",
            auditMetadata: { expected: order.price_cents, received: event.amountTotalCents },
          });
          break;
        }

        await transitionOrder(orderId, "paid", {
          paidAt: new Date(),
          stripePaymentIntentId: event.paymentIntentId ?? undefined,
          stripeCheckoutSessionId: event.checkoutSessionId ?? undefined,
          actorLabel: "webhook",
          auditMetadata: { amountCents: event.amountTotalCents },
        });
        break;
      }

      case "payment.failed": {
        await transitionOrder(orderId, "failed", {
          failedAt: new Date(),
          errorCode: "PAYMENT_FAILED",
          actorLabel: "webhook",
        });
        break;
      }

      case "checkout.expired": {
        await transitionOrder(orderId, "expired", { actorLabel: "webhook" });
        break;
      }

      case "refund.succeeded": {
        // Refunds can arrive from the Stripe dashboard without our refund flow,
        // so accept the terminal state from whatever the order's status is.
        if (order.status !== "refund_pending") {
          await transitionOrder(orderId, "refund_pending", {
            actorLabel: "webhook",
            auditMetadata: { source: "provider_dashboard" },
          });
        }
        await transitionOrder(orderId, "refunded", {
          refundedAt: new Date(),
          actorLabel: "webhook",
          auditMetadata: { amountCents: event.amountTotalCents },
        });
        break;
      }
    }
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      // The order already moved on — a late or out-of-order delivery. Not an
      // error: acknowledge it so the provider stops retrying.
      log.info("webhook.transition_noop", { orderId, from: error.from, to: error.to });
      await markEventProcessed(provider, event.eventId);
      return { handled: true, duplicate: true, orderId, action: "duplicate" };
    }
    throw error;
  }

  await markEventProcessed(provider, event.eventId);
  await recordAudit({
    orderId,
    kioskId: order.kiosk_id,
    actorLabel: "webhook",
    eventType: `payment.${event.type}`,
    metadata: { provider, paid: event.paid },
  });

  return { handled: true, duplicate: false, orderId, action: event.type };
}
