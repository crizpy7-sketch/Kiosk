import "server-only";
import { isDemoMode } from "@/lib/env";
import type { PaymentProvider } from "@/lib/payments/provider";
import { stripeProvider } from "@/lib/payments/stripe.server";
import { mockPaymentProvider } from "@/lib/payments/mock.server";

/** Resolves the active payment provider. Demo mode never reaches Stripe. */
export function getPaymentProvider(): PaymentProvider {
  return isDemoMode() ? mockPaymentProvider : stripeProvider;
}
