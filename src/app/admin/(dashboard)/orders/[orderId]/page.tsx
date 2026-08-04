import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/lib/auth/session.server";
import { getOrderById } from "@/lib/orders/repository";
import { mayRefund } from "@/lib/orders/state-machine";
import { findExperienceById } from "@/lib/config/experiences";
import { getLatestAssetForOrder, listGenerationSessionsForOrder } from "@/lib/db/repositories";
import { listAuditEvents } from "@/lib/audit";
import { OrderActions } from "@/app/admin/(dashboard)/orders/[orderId]/OrderActions";
import { EmptyState, formatDateTime, formatMoney, Panel, StatusBadge } from "@/components/admin/Ui";

export const dynamic = "force-dynamic";

/**
 * One order, everything about it, and the buttons to rescue it.
 *
 * This page is what a staff member opens with a customer standing in front of
 * them. Timeline first (what happened), then actions (what can be done), then
 * the audit trail (who did what).
 */
export default async function AdminOrderDetail({ params }: { params: Promise<{ orderId: string }> }) {
  const identity = await requirePermission("orders.view");
  const { orderId } = await params;

  const order = await getOrderById(orderId);
  if (!order) notFound();

  const [experience, sessions, asset, audit] = await Promise.all([
    Promise.resolve(findExperienceById(order.experience_id)),
    listGenerationSessionsForOrder(order.id),
    getLatestAssetForOrder(order.id),
    listAuditEvents(50, order.id),
  ]);

  const totalSeconds = sessions.reduce((sum, s) => sum + Number(s.billable_seconds_estimate), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/orders" className="text-[13px] text-wf-dim hover:underline">
            ← Orders
          </Link>
          <h1 className="mt-2 font-mono text-[26px] font-bold text-white">{order.public_reference}</h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={order.status} />
            {order.demo && (
              <span className="rounded-full bg-wf-green/15 px-2.5 py-1 text-[11px] font-semibold uppercase text-wf-green">
                demo
              </span>
            )}
          </div>
        </div>

        <div className="text-right">
          <p className="text-[28px] font-bold text-white">{formatMoney(order.price_cents)}</p>
          <p className="text-[13px] text-wf-dim">{experience?.name.en ?? order.experience_id}</p>
        </div>
      </div>

      {order.error_code && (
        <div className="rounded-2xl border border-wf-pink/50 bg-wf-pink/10 p-5" data-testid="order-error">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-wf-pink">Failure</p>
          <p className="mt-1 font-mono text-[15px] text-white">{order.error_code}</p>
          {order.paid_at && !order.refunded_at && (
            <p className="mt-2 text-[14px] text-white/85">
              This customer paid and did not get their photo. Refund or re-authorize below.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Timeline">
          <dl className="flex flex-col gap-3 text-[14px]">
            <Row label="Created" value={formatDateTime(order.created_at)} />
            <Row label="Paid" value={formatDateTime(order.paid_at)} />
            <Row label="Consented" value={formatDateTime(order.consented_at)} />
            <Row label="Generation started" value={formatDateTime(order.generation_started_at)} />
            <Row label="Generation finished" value={formatDateTime(order.generation_completed_at)} />
            <Row label="Delivered" value={formatDateTime(order.delivered_at)} />
            <Row label="Failed" value={formatDateTime(order.failed_at)} />
            <Row label="Refunded" value={formatDateTime(order.refunded_at)} />
            <Row label="Retake used" value={order.retake_used ? "Yes" : "No"} />
            <Row label="Language" value={order.language.toUpperCase()} />
          </dl>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="AI sessions">
            {sessions.length === 0 ? (
              <EmptyState>No AI session was started.</EmptyState>
            ) : (
              <div className="flex flex-col gap-3">
                {sessions.map((session) => (
                  <div key={session.id} className="rounded-xl border border-wf-border p-3 text-[13px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">
                        {session.model} {session.is_retake && "(retake)"}
                      </span>
                      <StatusBadge status={session.status} />
                    </div>
                    <p className="mt-1 text-wf-dim">
                      {Number(session.billable_seconds_estimate).toFixed(1)}s ·{" "}
                      {formatDateTime(session.started_at)}
                      {session.normalized_error_code && (
                        <span className="text-wf-pink"> · {session.normalized_error_code}</span>
                      )}
                    </p>
                  </div>
                ))}
                <p className="text-[13px] text-wf-dim">Total billable estimate: {totalSeconds.toFixed(1)}s</p>
              </div>
            )}
          </Panel>

          <Panel title="Delivery">
            {asset ? (
              <dl className="flex flex-col gap-3 text-[14px]">
                <Row label="Stored" value={formatDateTime(asset.created_at)} />
                <Row label="Expires" value={formatDateTime(asset.expires_at)} />
                <Row label="Downloaded" value={formatDateTime(asset.downloaded_at)} />
                <Row label="Size" value={`${Math.round(asset.byte_size / 1024)} KB`} />
              </dl>
            ) : (
              <EmptyState>No photo stored for this order.</EmptyState>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Actions">
        <OrderActions
          orderId={order.id}
          status={order.status}
          canRequestRefund={hasPermission(identity.role, "orders.request_refund") && mayRefund(order.status)}
          canCompleteRefund={hasPermission(identity.role, "refunds.issue") && mayRefund(order.status)}
          canRegenerateQr={hasPermission(identity.role, "orders.regenerate_qr") && Boolean(asset)}
          canDeletePhoto={
            hasPermission(identity.role, "orders.delete_photo") && Boolean(asset) && !asset?.deleted_at
          }
          canRetry={hasPermission(identity.role, "orders.assist") && order.status === "failed" && Boolean(order.paid_at)}
          alreadyHelped={Boolean(order.helped_at)}
          staffNote={order.staff_note}
        />
      </Panel>

      <Panel title="Audit trail">
        {audit.length === 0 ? (
          <EmptyState>Nothing recorded.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {audit.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-wf-border pb-2">
                <span className="font-mono text-white">{event.event_type}</span>
                <span className="text-wf-dim">{event.actor_label}</span>
                <span className="ml-auto text-wf-dim">{formatDateTime(event.created_at)}</span>
                {Object.keys(event.safe_metadata).length > 0 && (
                  <code className="w-full text-[12px] text-wf-dim/80">
                    {JSON.stringify(event.safe_metadata)}
                  </code>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-wf-dim">{label}</dt>
      <dd className="text-right text-white">{value}</dd>
    </div>
  );
}
