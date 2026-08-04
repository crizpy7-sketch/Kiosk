import "server-only";
import { isDemoPayments } from "@/lib/env";
import type { PaymentProvider } from "@/lib/payments/provider";
import { stripeProvider } from "@/lib/payments/stripe.server";
import { mockPaymentProvider } from "@/lib/payments/mock.server";

/** Resolves the active payment provider. Demo mode never reaches Stripe. */
export function getPaymentProvider(): PaymentProvider {
  return isDemoPayments() ? mockPaymentProvider : stripeProvider;
}
