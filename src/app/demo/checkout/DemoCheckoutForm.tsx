"use client";

import { useState } from "react";
import { Spinner, TouchButton } from "@/components/kiosk/Primitives";

/**
 * The three outcomes a real checkout can produce, so the kiosk's recovery paths
 * are exercisable without touching Stripe: approve, decline, and walk away.
 */
export function DemoCheckoutForm({
  sessionId,
  orderId,
  amountCents,
}: {
  sessionId: string;
  orderId: string;
  amountCents: number;
}) {
  const [busy, setBusy] = useState<"pay" | "fail" | null>(null);

  async function submit(outcome: "paid" | "failed"): Promise<void> {
    setBusy(outcome === "paid" ? "pay" : "fail");
    try {
      // The signature is produced server-side; the browser never holds APP_SECRET.
      await fetch("/api/demo/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, orderId, amountCents, outcome }),
      });
    } catch {
      // Fall through: the kiosk's own polling and timeout handle a lost request.
    }
    window.location.assign(
      `/kiosk/return?order=${encodeURIComponent(orderId)}&result=${outcome === "paid" ? "success" : "cancel"}`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TouchButton onClick={() => void submit("paid")} disabled={busy !== null} data-testid="demo-pay">
        {busy === "pay" ? <Spinner className="h-8 w-8" /> : "APPROVE PAYMENT"}
      </TouchButton>

      <TouchButton
        variant="danger"
        size="md"
        onClick={() => void submit("failed")}
        disabled={busy !== null}
        data-testid="demo-decline"
      >
        SIMULATE DECLINE
      </TouchButton>

      <TouchButton
        variant="ghost"
        size="md"
        onClick={() =>
          window.location.assign(`/kiosk/return?order=${encodeURIComponent(orderId)}&result=cancel`)
        }
        disabled={busy !== null}
        data-testid="demo-cancel"
      >
        CANCEL
      </TouchButton>
    </div>
  );
}
