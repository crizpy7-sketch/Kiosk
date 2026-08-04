import "server-only";
import Stripe from "stripe";
import { getEnv } from "@/lib/env";
import {
  PaymentProviderError,
  type CheckoutSession,
  type CheckoutSessionInput,
  type PaymentEvent,
  type PaymentProvider,
  type RefundResult,
} from "@/lib/payments/provider";

/**
 * Stripe Checkout Sessions.
 *
 * Checkout (rather than Elements or a Payment Intent we render ourselves) is the
 * right fit for a supervised kiosk: Apple Pay and Google Pay come for free on
 * iPadOS Safari, Stripe hosts the card fields so no card data touches this app,
 * and the redirect back is a plain URL — no SDK in the customer's path.
 *
 * The price is *never* taken from the browser. It is read from the experience
 * row on the server and used to build a `price_data` line item, so a tampered
 * client cannot buy a $5.99 transformation for $0.50.
 */

let cached: Stripe | null = null;

function stripe(): Stripe {
  if (cached) return cached;
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) throw new PaymentProviderError("NOT_CONFIGURED", "STRIPE_SECRET_KEY is not configured.");
  cached = new Stripe(key, {
    // Pinned so a Stripe-side API change can't alter behaviour under a live kiosk.
    apiVersion: "2025-08-27.basil",
    typescript: true,
    maxNetworkRetries: 2,
    timeout: 15_000,
  });
  return cached;
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  isMock: false,

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    try {
      const session = await stripe().checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency,
                unit_amount: input.priceCents,
                product_data: {
                  name: `Wild Frame AI — ${input.experienceName}`,
                  description: "AI Transformation + Digital Photo",
                },
              },
            },
          ],
          // Read back on the webhook to find the order. Metadata is on both the
          // session and the payment intent so a refund event can be traced too.
          metadata: {
            order_id: input.orderId,
            public_reference: input.publicReference,
            experience_slug: input.experienceSlug,
            language: input.language,
          },
          payment_intent_data: {
            metadata: { order_id: input.orderId, public_reference: input.publicReference },
          },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          // A kiosk customer is standing there; a stale tab is worse than a retry.
          expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
          client_reference_id: input.publicReference,
        },
        // Stripe-side dedupe: a double-tapped Pay button yields one session.
        { idempotencyKey: `checkout_${input.orderId}` },
      );

      if (!session.url) {
        throw new PaymentProviderError("NO_CHECKOUT_URL", "Stripe returned a session without a URL.");
      }
      return { id: session.id, url: session.url };
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError("CHECKOUT_CREATE_FAILED", "Could not create a Stripe Checkout Session.", error);
    }
  },

  async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent> {
    const secret = getEnv().STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new PaymentProviderError("NOT_CONFIGURED", "STRIPE_WEBHOOK_SECRET is not configured.");
    if (!signatureHeader) throw new PaymentProviderError("INVALID_SIGNATURE", "Missing stripe-signature header.");

    let event: Stripe.Event;
    try {
      event = await stripe().webhooks.constructEventAsync(rawBody, signatureHeader, secret);
    } catch (error) {
      throw new PaymentProviderError("INVALID_SIGNATURE", "Stripe webhook signature verification failed.", error);
    }

    return normalizeStripeEvent(event);
  },

  async refund(paymentIntentId: string, amountCents?: number): Promise<RefundResult> {
    try {
      const refund = await stripe().refunds.create(
        {
          payment_intent: paymentIntentId,
          ...(amountCents !== undefined ? { amount: amountCents } : {}),
        },
        { idempotencyKey: `refund_${paymentIntentId}` },
      );
      const status: RefundResult["status"] =
        refund.status === "succeeded" ? "succeeded" : refund.status === "failed" ? "failed" : "pending";
      return { id: refund.id, status };
    } catch (error) {
      throw new PaymentProviderError("REFUND_FAILED", "Stripe refund failed.", error);
    }
  },
};

/** Exported for unit tests — pure mapping, no network. */
export function normalizeStripeEvent(event: Stripe.Event): PaymentEvent {
  const base = { eventId: event.id, orderId: null, checkoutSessionId: null, paymentIntentId: null } as const;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        ...base,
        type: "checkout.completed",
        orderId: session.metadata?.order_id ?? null,
        checkoutSessionId: session.id,
        paymentIntentId: readPaymentIntentId(session.payment_intent),
        amountTotalCents: session.amount_total ?? null,
        // The single most important line in the payment path: a completed
        // Checkout Session is only fulfilment when Stripe says it is paid.
        // Delayed methods complete the session while still unpaid.
        paid: session.payment_status === "paid",
      };
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        ...base,
        type: "payment.failed",
        orderId: session.metadata?.order_id ?? null,
        checkoutSessionId: session.id,
        paymentIntentId: readPaymentIntentId(session.payment_intent),
        amountTotalCents: session.amount_total ?? null,
        paid: false,
      };
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        ...base,
        type: "checkout.expired",
        orderId: session.metadata?.order_id ?? null,
        checkoutSessionId: session.id,
        paymentIntentId: readPaymentIntentId(session.payment_intent),
        amountTotalCents: session.amount_total ?? null,
        paid: false,
      };
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      return {
        ...base,
        type: "payment.failed",
        orderId: intent.metadata?.order_id ?? null,
        paymentIntentId: intent.id,
        amountTotalCents: intent.amount ?? null,
        paid: false,
      };
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      return {
        ...base,
        type: "refund.succeeded",
        orderId: charge.metadata?.order_id ?? null,
        paymentIntentId: readPaymentIntentId(charge.payment_intent),
        amountTotalCents: charge.amount_refunded ?? null,
        paid: false,
      };
    }

    default:
      return { ...base, type: "ignored", amountTotalCents: null, paid: false };
  }
}

function readPaymentIntentId(value: string | Stripe.PaymentIntent | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
