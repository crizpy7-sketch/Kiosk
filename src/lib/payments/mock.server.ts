import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
 * Demo payment provider. Charges nothing, reaches no network.
 *
 * It is *not* a shortcut around the state machine: the demo checkout page still
 * posts a signed webhook to the same /api/webhooks/stripe route, which still
 * verifies the signature, still dedupes on event id, and still drives the same
 * transitions. Demo mode exercises production plumbing — that is the point.
 *
 * The signature uses APP_SECRET rather than a Stripe key, so a demo webhook can
 * never validate against a live deployment.
 */

const MOCK_SIGNATURE_HEADER_PREFIX = "demo,v1=";

function signingKey(): string {
  return `${getEnv().APP_SECRET}:demo-webhook`;
}

/** Signs a demo webhook body. Used by the demo checkout page. */
export function signMockWebhook(rawBody: string): string {
  const mac = createHmac("sha256", signingKey()).update(rawBody).digest("hex");
  return `${MOCK_SIGNATURE_HEADER_PREFIX}${mac}`;
}

export const mockPaymentProvider: PaymentProvider = {
  name: "demo",
  isMock: true,

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const id = `cs_demo_${randomUUID().replace(/-/g, "")}`;
    const url = new URL("/demo/checkout", getEnv().APP_BASE_URL);
    url.searchParams.set("session", id);
    url.searchParams.set("order", input.orderId);
    url.searchParams.set("amount", String(input.priceCents));
    url.searchParams.set("name", input.experienceName);
    url.searchParams.set("lang", input.language);
    return { id, url: url.toString() };
  },

  async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent> {
    if (!signatureHeader?.startsWith(MOCK_SIGNATURE_HEADER_PREFIX)) {
      throw new PaymentProviderError("INVALID_SIGNATURE", "Missing or malformed demo signature.");
    }
    const provided = Buffer.from(signatureHeader.slice(MOCK_SIGNATURE_HEADER_PREFIX.length), "hex");
    const expected = createHmac("sha256", signingKey()).update(rawBody).digest();

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new PaymentProviderError("INVALID_SIGNATURE", "Demo webhook signature verification failed.");
    }

    const parsed = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      order_id?: string;
      checkout_session_id?: string;
      amount_total?: number;
      paid?: boolean;
    };

    const type: PaymentEvent["type"] =
      parsed.type === "checkout.completed"
        ? "checkout.completed"
        : parsed.type === "payment.failed"
          ? "payment.failed"
          : parsed.type === "refund.succeeded"
            ? "refund.succeeded"
            : "ignored";

    return {
      eventId: parsed.id ?? randomUUID(),
      type,
      orderId: parsed.order_id ?? null,
      checkoutSessionId: parsed.checkout_session_id ?? null,
      paymentIntentId: parsed.checkout_session_id ? `pi_demo_${parsed.checkout_session_id.slice(-16)}` : null,
      amountTotalCents: parsed.amount_total ?? null,
      paid: parsed.paid === true,
    };
  },

  async refund(paymentIntentId: string): Promise<RefundResult> {
    return { id: `re_demo_${paymentIntentId.slice(-12)}`, status: "succeeded" };
  },
};
