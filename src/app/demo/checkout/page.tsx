import { notFound } from "next/navigation";
import { DemoCheckoutForm } from "@/app/demo/checkout/DemoCheckoutForm";
import { formatPrice } from "@/lib/public-config";
import { isDemoPayments } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Demo checkout — the stand-in for Stripe's hosted page.
 *
 * It is a 404 unless DEMO_MODE is on, and DEMO_MODE is itself refused in
 * production by env validation. Approving here does not mark anything paid: it
 * posts a signed demo webhook to the real webhook route, which verifies the
 * signature and drives the same state machine. Demo mode exercises production
 * plumbing rather than bypassing it.
 */
export default async function DemoCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isDemoPayments()) notFound();

  const params = await searchParams;
  const read = (key: string): string => (typeof params[key] === "string" ? params[key] : "");

  const sessionId = read("session");
  const orderId = read("order");
  const amountCents = Number(read("amount")) || 599;
  const name = read("name") || "AI Transformation";

  if (!sessionId || !orderId) notFound();

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-wf-ink px-8 py-12">
      <div className="w-full max-w-[520px] rounded-3xl border-2 border-wf-green/60 bg-wf-surface p-9">
        <p className="wf-display mb-6 rounded-full bg-wf-green px-4 py-2 text-center text-[15px] tracking-[0.2em] text-black">
          DEMO MODE — NO REAL CHARGE
        </p>

        <h1 className="wf-display text-[30px] text-white">{name}</h1>
        <p className="mt-1 text-[18px] text-wf-dim">AI Transformation + Digital Photo</p>

        <p className="wf-display my-8 text-center text-[76px] leading-none text-wf-green">
          {formatPrice(amountCents)}
        </p>

        <DemoCheckoutForm sessionId={sessionId} orderId={orderId} amountCents={amountCents} />

        <p className="mt-6 text-center text-[15px] leading-relaxed text-wf-dim">
          This page stands in for Stripe Checkout. No card is collected and no charge is made.
          Approving posts a signed demo webhook to the same endpoint Stripe would call.
        </p>
      </div>
    </main>
  );
}
