/**
 * Payment provider abstraction.
 *
 * The rule this interface exists to enforce: the browser reaching a success URL
 * proves nothing. Only `verifyWebhook` produces a fulfilment signal, and only
 * the server acts on it.
 */

export interface CheckoutSessionInput {
  orderId: string;
  publicReference: string;
  experienceSlug: string;
  experienceName: string;
  priceCents: number;
  currency: string;
  language: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Provider session id, stored on the order. */
  id: string;
  /** Where to send the customer. In demo mode this is an in-app route. */
  url: string;
}

/** Normalised fulfilment signal extracted from a verified webhook. */
export interface PaymentEvent {
  /** Provider event id — the idempotency key. */
  eventId: string;
  type:
    | "checkout.completed"
    | "checkout.expired"
    | "payment.failed"
    | "refund.succeeded"
    | "ignored";
  orderId: string | null;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  amountTotalCents: number | null;
  /** True only when the provider says money actually moved. */
  paid: boolean;
}

export interface RefundResult {
  id: string;
  status: "succeeded" | "pending" | "failed";
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export interface PaymentProvider {
  readonly name: string;
  readonly isMock: boolean;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  /**
   * Verifies the signature over the raw request body and returns a normalised
   * event. Throws PaymentProviderError("INVALID_SIGNATURE") when verification
   * fails — the route must answer 400 and do nothing else.
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent>;
  refund(paymentIntentId: string, amountCents?: number): Promise<RefundResult>;
}
