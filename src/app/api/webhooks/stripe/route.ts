import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { getPaymentProvider } from "@/lib/payments/index.server";
import { PaymentProviderError } from "@/lib/payments/provider";
import { applyPaymentEvent } from "@/lib/orders/fulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The payment webhook — the only thing in this system that may mark an order paid.
 *
 * Order of operations matters:
 *   1. Read the RAW body. Stripe signs bytes; parsing first breaks verification.
 *   2. Verify the signature. Failure ⇒ 400, and nothing else happens.
 *   3. Hand the verified, normalised event to fulfilment, which dedupes.
 *
 * Anything unexpected after verification returns 500 so the provider retries —
 * losing a paid event silently is far worse than processing it twice (which
 * fulfilment is built to absorb).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const provider = getPaymentProvider();

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return fail(400, "INVALID_BODY", "Could not read the request body.");
  }

  const signature =
    request.headers.get("stripe-signature") ?? request.headers.get("x-demo-signature");

  try {
    const event = await provider.verifyWebhook(rawBody, signature);
    const outcome = await applyPaymentEvent(provider.name, event);

    log.info("webhook.processed", {
      provider: provider.name,
      eventType: event.type,
      orderId: outcome.orderId,
      duplicate: outcome.duplicate,
      action: outcome.action,
    });

    return ok({ received: true, duplicate: outcome.duplicate });
  } catch (error) {
    if (error instanceof PaymentProviderError && error.code === "INVALID_SIGNATURE") {
      // Do not leak why it failed, and do not retry-loop the sender.
      log.warn("webhook.invalid_signature", { provider: provider.name });
      return fail(400, "INVALID_SIGNATURE", "Signature verification failed.");
    }
    return handleApiError("POST /api/webhooks/stripe", error);
  }
}
