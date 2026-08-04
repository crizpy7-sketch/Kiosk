import Link from "next/link";
import { getEnv } from "@/lib/env";
import { requirePermission, hasPermission } from "@/lib/auth/session.server";
import { getDashboardMetrics, getPilotProgress } from "@/lib/admin/metrics";
import { listOrders } from "@/lib/orders/repository";
import { EmptyState, formatDateTime, formatMoney, Panel, StatCard, StatusBadge } from "@/components/admin/Ui";
import { isDemoAi, isDemoPayments } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The dashboard.
 *
 * Ten cards that answer: did today work, is anyone stuck, and is the kiosk
 * alive. Battery honestly reports "unknown" where Safari does not expose the
 * Battery Status API, rather than showing a number nobody measured.
 */
export default async function AdminDashboard() {
  const identity = await requirePermission("kiosk.view");
  const env = getEnv();

  const [metrics, pilot, recent] = await Promise.all([
    getDashboardMetrics(env.KIOSK_ID),
    getPilotProgress(env.KIOSK_ID),
    listOrders({ limit: 8 }),
  ]);

  const canSeeRevenue = hasPermission(identity.role, "revenue.view");
  const battery = metrics.kioskBatteryPercent;
  const batteryTone = battery === null ? "neutral" : battery < 15 ? "bad" : battery < 30 ? "warn" : "good";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-white">Today</h1>
          <p className="mt-1 text-[14px] text-wf-dim">
            {isDemoPayments()
              ? isDemoAi()
                ? "Demo mode — no real charges, simulated AI."
                : "Demo checkout — no real charges, but the AI is live and billing."
              : "Live mode."}
          </p>
        </div>

        <div className="rounded-2xl border border-wf-green/40 bg-wf-green/10 px-5 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-wf-green">Pilot progress</p>
          <p className="mt-1 text-[20px] font-bold text-white" data-testid="pilot-progress">
            {pilot.delivered} / {pilot.target} delivered
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {canSeeRevenue && (
          <StatCard
            label="Today's revenue"
            value={formatMoney(metrics.todayRevenueCents)}
            hint={metrics.todayRefundedCents > 0 ? `${formatMoney(metrics.todayRefundedCents)} refunded` : undefined}
            tone="good"
            testId="stat-revenue"
          />
        )}
        <StatCard label="Paid sessions" value={String(metrics.paidSessions)} testId="stat-paid" />
        <StatCard
          label="Deliveries"
          value={String(metrics.successfulDeliveries)}
          tone="good"
          testId="stat-deliveries"
        />
        <StatCard
          label="Failed sessions"
          value={String(metrics.failedSessions)}
          tone={metrics.failedSessions > 0 ? "bad" : "neutral"}
          testId="stat-failed"
        />
        <StatCard
          label="Refunds"
          value={String(metrics.refunds)}
          tone={metrics.refunds > 0 ? "warn" : "neutral"}
          testId="stat-refunds"
        />

        <StatCard
          label="AI seconds today"
          value={String(Math.round(metrics.aiSecondsToday))}
          hint={`Limit ${metrics.aiDailyLimitSeconds}s`}
          tone={metrics.aiSecondsToday >= metrics.aiDailyLimitSeconds ? "bad" : "neutral"}
          testId="stat-ai-seconds"
        />
        {canSeeRevenue && (
          <StatCard
            label="Est. AI cost"
            value={formatMoney(metrics.aiCostEstimateCents)}
            hint="Estimate only"
            testId="stat-ai-cost"
          />
        )}
        <StatCard
          label="Kiosk"
          value={metrics.kioskOnline ? "Online" : "Offline"}
          hint={`Last seen ${formatDateTime(metrics.kioskLastSeenAt)}`}
          tone={metrics.kioskOnline ? "good" : "bad"}
          testId="stat-kiosk"
        />
        <StatCard
          label="Battery"
          value={battery === null ? "Unknown" : `${battery}%`}
          hint={
            battery === null
              ? "Safari doesn't report battery"
              : metrics.kioskBatteryCharging
                ? "Charging"
                : "On battery"
          }
          tone={batteryTone}
          testId="stat-battery"
        />
        <StatCard
          label="Active styles"
          value={`${metrics.activeExperiences}/${metrics.totalExperiences}`}
          testId="stat-styles"
        />
      </div>

      <Panel
        title="Recent orders"
        action={
          <Link href="/admin/orders" className="text-[13px] text-wf-pink hover:underline">
            View all →
          </Link>
        }
      >
        {recent.length === 0 ? (
          <EmptyState>No orders yet. The first customer will show up here.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead className="text-[12px] uppercase tracking-wide text-wf-dim">
                <tr>
                  <th className="pb-3 pr-4">Reference</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Amount</th>
                  <th className="pb-3 pr-4">Created</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-wf-border">
                {recent.map((order) => (
                  <tr key={order.id}>
                    <td className="py-3 pr-4 font-mono text-[13px] text-white">{order.public_reference}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="py-3 pr-4 text-wf-dim">{formatMoney(order.price_cents)}</td>
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

      <Panel title="Last successful transaction">
        {metrics.lastSuccessfulReference ? (
          <p className="text-[15px] text-white">
            <span className="font-mono">{metrics.lastSuccessfulReference}</span>
            <span className="text-wf-dim"> — {formatDateTime(metrics.lastSuccessfulAt)}</span>
          </p>
        ) : (
          <EmptyState>Nothing delivered yet.</EmptyState>
        )}
      </Panel>
    </div>
  );
}
