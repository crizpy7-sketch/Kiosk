"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import {
  completeRefundAction,
  deletePhotoAction,
  markHelpedAction,
  regenerateQrAction,
  requestRefundAction,
  retryOrderAction,
  type ActionResult,
} from "@/lib/admin/actions";

/**
 * Staff/owner actions for one order.
 *
 * Buttons are hidden when the caller lacks the permission, but that is only
 * tidiness — every action re-checks on the server. Refunds and re-authorization
 * ask for confirmation first: both are visible to a customer standing there and
 * neither should ever be a stray tap.
 */
export function OrderActions({
  orderId,
  status,
  canRequestRefund,
  canCompleteRefund,
  canRegenerateQr,
  canDeletePhoto,
  canRetry,
  alreadyHelped,
  staffNote,
}: {
  orderId: string;
  status: string;
  canRequestRefund: boolean;
  canCompleteRefund: boolean;
  canRegenerateQr: boolean;
  canDeletePhoto: boolean;
  canRetry: boolean;
  alreadyHelped: boolean;
  staffNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [note, setNote] = useState(staffNote ?? "");
  const [qr, setQr] = useState<{ dataUri: string; url: string } | null>(null);

  function run(action: () => Promise<ActionResult>, confirmMessage?: string): void {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      const data = outcome.data;
      if (outcome.ok && typeof data?.["qrDataUri"] === "string") {
        setQr({ dataUri: data["qrDataUri"], url: String(data["downloadUrl"] ?? "") });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {result && (
        <p
          role="status"
          data-testid="action-result"
          className={`rounded-xl px-4 py-3 text-[14px] ${
            result.ok ? "bg-wf-green/15 text-wf-green" : "bg-wf-pink/15 text-wf-pink"
          }`}
        >
          {result.message}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {canRetry && (
          <ActionButton
            testId="action-retry"
            disabled={pending}
            onClick={() =>
              run(
                () => retryOrderAction(orderId),
                "Re-authorize this paid order so the customer can try again at no extra charge?",
              )
            }
          >
            Re-authorize retry
          </ActionButton>
        )}

        {canRegenerateQr && (
          <ActionButton
            testId="action-regenerate-qr"
            disabled={pending}
            onClick={() =>
              run(
                () => regenerateQrAction(orderId),
                "Create a new download link? The previous QR code will stop working.",
              )
            }
          >
            Regenerate QR
          </ActionButton>
        )}

        {canDeletePhoto && (
          <ActionButton
            testId="action-delete-photo"
            variant="danger"
            disabled={pending}
            onClick={() =>
              run(
                () => deletePhotoAction(orderId, note || "Customer requested deletion"),
                "Delete this customer's photo now? This cannot be undone and the download link stops working immediately.",
              )
            }
          >
            Delete photo
          </ActionButton>
        )}

        {canRequestRefund && status !== "refund_pending" && (
          <ActionButton
            testId="action-request-refund"
            disabled={pending}
            onClick={() => run(() => requestRefundAction(orderId, note || "Requested at kiosk"))}
          >
            Request refund
          </ActionButton>
        )}

        {canCompleteRefund && (
          <ActionButton
            testId="action-complete-refund"
            variant="danger"
            disabled={pending}
            onClick={() =>
              run(
                () => completeRefundAction(orderId),
                "Refund this customer now? This moves real money in live mode.",
              )
            }
          >
            Complete refund
          </ActionButton>
        )}
      </div>

      {qr && (
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-wf-border p-4">
          <Image
            src={qr.dataUri}
            alt="New download QR code"
            width={180}
            height={180}
            unoptimized
            data-testid="regenerated-qr"
            className="rounded-xl bg-white p-2"
          />
          <p className="max-w-[420px] text-[13px] text-wf-dim">
            Show this to the customer. The previous link no longer works.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-wf-border pt-5">
        <label className="text-[13px] font-semibold uppercase tracking-wide text-wf-dim" htmlFor="staff-note">
          Staff note
        </label>
        <textarea
          id="staff-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          data-testid="staff-note"
          placeholder="What happened and what you did."
          className="rounded-xl border border-wf-border bg-wf-ink px-3 py-2 text-[14px] text-white outline-none focus:border-wf-pink"
        />
        <div className="flex items-center gap-3">
          <ActionButton
            testId="action-mark-helped"
            disabled={pending}
            onClick={() => run(() => markHelpedAction(orderId, note))}
          >
            {alreadyHelped ? "Update note" : "Mark customer helped"}
          </ActionButton>
          {alreadyHelped && <span className="text-[13px] text-wf-green">Already marked as helped</span>}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "default",
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  variant?: "default" | "danger";
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`min-h-[44px] rounded-xl px-5 text-[14px] font-semibold transition-colors disabled:opacity-50 ${
        variant === "danger"
          ? "bg-wf-pink text-white hover:bg-wf-pink-deep"
          : "border border-wf-border text-white hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}
