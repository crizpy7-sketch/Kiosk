import type { ReactNode } from "react";

/**
 * Admin presentation primitives. Plain, dense and readable — the kiosk gets the
 * brand energy; the dashboard gets out of the owner's way.
 */

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  testId?: string;
}) {
  const toneClass = {
    neutral: "text-white",
    good: "text-wf-green",
    warn: "text-wf-gold",
    bad: "text-wf-pink",
  }[tone];

  return (
    <div className="rounded-2xl border border-wf-border bg-wf-surface p-5" data-testid={testId}>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-wf-dim">{label}</p>
      <p className={`mt-2 text-[30px] font-bold leading-none ${toneClass}`}>{value}</p>
      {hint && <p className="mt-2 text-[13px] text-wf-dim">{hint}</p>}
    </div>
  );
}

export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-wf-border bg-wf-surface">
      <header className="flex items-center justify-between gap-4 border-b border-wf-border px-5 py-4">
        <h2 className="text-[15px] font-semibold uppercase tracking-wide text-white">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATUS_TONES: Record<string, string> = {
  delivered: "bg-wf-green/15 text-wf-green",
  completed: "bg-wf-green/15 text-wf-green",
  paid: "bg-wf-green/15 text-wf-green",
  generating: "bg-wf-blue/20 text-[#7fc4ff]",
  captured: "bg-wf-blue/20 text-[#7fc4ff]",
  generation_authorized: "bg-wf-blue/20 text-[#7fc4ff]",
  consented: "bg-wf-blue/20 text-[#7fc4ff]",
  failed: "bg-wf-pink/20 text-wf-pink",
  refund_pending: "bg-wf-gold/20 text-wf-gold",
  refunded: "bg-wf-gold/20 text-wf-gold",
  expired: "bg-white/10 text-wf-dim",
  created: "bg-white/10 text-wf-dim",
  payment_pending: "bg-white/10 text-wf-dim",
  deleted: "bg-white/10 text-wf-dim",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        STATUS_TONES[status] ?? "bg-white/10 text-wf-dim"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDateTime(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-[14px] text-wf-dim">{children}</p>;
}
