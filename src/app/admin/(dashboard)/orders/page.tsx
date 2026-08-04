import Link from "next/link";
import { requirePermission } from "@/lib/auth/session.server";
import { listOrders } from "@/lib/orders/repository";
import { isOrderStatus, type OrderStatus } from "@/lib/orders/state-machine";
import { getStatusCounts } from "@/lib/admin/metrics";
import { getEnv } from "@/lib/env";
import { EmptyState, formatDateTime, formatMoney, Panel, StatusBadge } from "@/components/admin/Ui";

export const dynamic = "force-dynamic";

/** Preset filters. "Needs attention" is the one staff actually live in. */
const FILTERS: { key: string; label: string; statuses?: OrderStatus[] }[] = [
  { key: "attention", label: "Needs attention", statuses: ["failed", "refund_pending"] },
  { key: "all", label: "All" },
  { key: "delivered", label: "Delivered", statuses: ["delivered", "completed"] },
  { key: "paid", label: "Paid", statuses: ["paid", "consented", "generation_authorized", "generating", "captured"] },
  { key: "refunded", label: "Refunded", statuses: ["refunded"] },
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("orders.view");

  const params = await searchParams;
  const filterKey = typeof params["filter"] === "string" ? params["filter"] : "attention";
  const search = typeof params["q"] === "string" ? params["q"].trim() : "";
  const statusParam = typeof params["status"] === "string" ? params["status"] : "";

  const preset = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0]!;
  const statuses = isOrderStatus(statusParam) ? [statusParam] : preset.statuses;

  const [orders, counts] = await Promise.all([
    listOrders({
      ...(statuses ? { status: statuses } : {}),
      ...(search ? { search } : {}),
      limit: 100,
    }),
    getStatusCounts(getEnv().KIOSK_ID),
  ]);

  const attentionCount = (counts["failed"] ?? 0) + (counts["refund_pending"] ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-bold text-white">Orders</h1>
        <p className="mt-1 text-[14px] text-wf-dim">
          {attentionCount > 0
            ? `${attentionCount} order${attentionCount === 1 ? "" : "s"} need attention.`
            : "Nothing needs attention right now."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <Link
            key={filter.key}
            href={`/admin/orders?filter=${filter.key}`}
            data-testid={`filter-${filter.key}`}
            className={`rounded-lg border px-4 py-2 text-[13px] transition-colors ${
              filter.key === filterKey
                ? "border-wf-pink bg-wf-pink/15 text-white"
                : "border-wf-border text-wf-dim hover:bg-white/5"
            }`}
          >
            {filter.label}
          </Link>
        ))}

        {/* GET form: the filter lives in the URL, so staff can bookmark or read
            a reference aloud and land on the same view. */}
        <form method="get" action="/admin/orders" className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value="all" />
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Reference (WF-…)"
            data-testid="order-search"
            className="min-h-[40px] w-[200px] rounded-lg border border-wf-border bg-wf-ink px-3 text-[14px] text-white outline-none focus:border-wf-pink"
          />
          <button
            type="submit"
            className="min-h-[40px] rounded-lg border border-wf-border px-4 text-[13px] text-wf-dim hover:bg-white/5"
          >
            Find
          </button>
        </form>
      </div>

      <Panel title={`${orders.length} order${orders.length === 1 ? "" : "s"}`}>
        {orders.length === 0 ? (
          <EmptyState>
            {search ? `No order matches “${search}”.` : "No orders in this view."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[14px]" data-testid="orders-table">
              <thead className="text-[12px] uppercase tracking-wide text-wf-dim">
                <tr>
                  <th className="pb-3 pr-4">Reference</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Amount</th>
                  <th className="pb-3 pr-4">Error</th>
                  <th className="pb-3 pr-4">Created</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-wf-border">
                {orders.map((order) => (
                  <tr key={order.id} data-testid={`order-row-${order.public_reference}`}>
                    <td className="py-3 pr-4 font-mono text-[13px] text-white">{order.public_reference}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="py-3 pr-4 text-wf-dim">{formatMoney(order.price_cents)}</td>
                    <td className="py-3 pr-4 text-[12px] text-wf-pink">{order.error_code ?? "—"}</td>
                    <td className="py-3 pr-4 text-wf-dim">{formatDateTime(order.created_at)}</td>
                    <td className="py-3">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-[13px] text-wf-pink hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
