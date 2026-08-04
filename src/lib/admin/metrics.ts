import "server-only";
import { query, queryOne } from "@/lib/db/client";
import { getAiSecondsUsedToday, getKiosk, isKioskOnline, listResolvedExperiences } from "@/lib/db/repositories";
import type { KioskRow } from "@/lib/db/types";

/**
 * Dashboard metrics.
 *
 * Deliberately small: ten numbers that tell an owner whether today worked and
 * whether anyone is stuck. The pilot's goal is 25 delivered transformations —
 * business intelligence beyond that is not something to build before the
 * customer flow has proven itself.
 */

/**
 * Rough Decart cost estimate. Not a bill: it is a running order-of-magnitude
 * signal so the owner notices a runaway before the invoice does. The rate is a
 * setting, and the UI labels the figure as an estimate.
 */
export const DEFAULT_AI_COST_PER_SECOND_CENTS = 0.5;

export interface DashboardMetrics {
  todayRevenueCents: number;
  todayRefundedCents: number;
  paidSessions: number;
  successfulDeliveries: number;
  failedSessions: number;
  refunds: number;
  aiSecondsToday: number;
  aiCostEstimateCents: number;
  aiDailyLimitSeconds: number;
  kioskOnline: boolean;
  kioskBatteryPercent: number | null;
  kioskBatteryCharging: boolean | null;
  kioskLastSeenAt: Date | null;
  lastSuccessfulAt: Date | null;
  lastSuccessfulReference: string | null;
  activeExperiences: number;
  totalExperiences: number;
  lifetimeDelivered: number;
}

export async function getDashboardMetrics(kioskId: string): Promise<DashboardMetrics> {
  const [today, kiosk, aiSeconds, lastSuccess, experiences, lifetime] = await Promise.all([
    queryOne<{
      revenue: string | null;
      refunded: string | null;
      paid_sessions: string;
      deliveries: string;
      failures: string;
      refunds: string;
    }>(
      `SELECT
         COALESCE(SUM(price_cents) FILTER (WHERE paid_at IS NOT NULL AND refunded_at IS NULL), 0) AS revenue,
         COALESCE(SUM(price_cents) FILTER (WHERE refunded_at IS NOT NULL), 0)                     AS refunded,
         COUNT(*) FILTER (WHERE paid_at IS NOT NULL)                                              AS paid_sessions,
         COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)                                         AS deliveries,
         COUNT(*) FILTER (WHERE status = 'failed')                                                AS failures,
         COUNT(*) FILTER (WHERE status IN ('refunded', 'refund_pending'))                         AS refunds
       FROM orders
       WHERE kiosk_id = $1 AND created_at >= date_trunc('day', now())`,
      [kioskId],
    ),
    getKiosk(kioskId),
    getAiSecondsUsedToday(kioskId),
    queryOne<{ delivered_at: Date; public_reference: string }>(
      `SELECT delivered_at, public_reference FROM orders
        WHERE kiosk_id = $1 AND delivered_at IS NOT NULL
        ORDER BY delivered_at DESC LIMIT 1`,
      [kioskId],
    ),
    listResolvedExperiences({ includeInactive: true }),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM orders WHERE kiosk_id = $1 AND delivered_at IS NOT NULL`,
      [kioskId],
    ),
  ]);

  return {
    todayRevenueCents: Number(today?.revenue ?? 0),
    todayRefundedCents: Number(today?.refunded ?? 0),
    paidSessions: Number(today?.paid_sessions ?? 0),
    successfulDeliveries: Number(today?.deliveries ?? 0),
    failedSessions: Number(today?.failures ?? 0),
    refunds: Number(today?.refunds ?? 0),
    aiSecondsToday: aiSeconds,
    aiCostEstimateCents: Math.round(aiSeconds * DEFAULT_AI_COST_PER_SECOND_CENTS),
    aiDailyLimitSeconds: kiosk?.daily_ai_limit_seconds ?? 3600,
    kioskOnline: kiosk ? isKioskOnline(kiosk) : false,
    kioskBatteryPercent: kiosk?.battery_percent ?? null,
    kioskBatteryCharging: kiosk?.battery_charging ?? null,
    kioskLastSeenAt: kiosk?.last_seen_at ?? null,
    lastSuccessfulAt: lastSuccess?.delivered_at ?? null,
    lastSuccessfulReference: lastSuccess?.public_reference ?? null,
    activeExperiences: experiences.filter((e) => e.active).length,
    totalExperiences: experiences.length,
    lifetimeDelivered: Number(lifetime?.count ?? 0),
  };
}

/** Pilot progress toward the first 25 paid, delivered transformations. */
export async function getPilotProgress(kioskId: string): Promise<{ delivered: number; target: number }> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM orders
      WHERE kiosk_id = $1 AND delivered_at IS NOT NULL AND refunded_at IS NULL`,
    [kioskId],
  );
  return { delivered: Number(row?.count ?? 0), target: 25 };
}

export type { KioskRow };

/** Counts of every order status — drives the failures view filters. */
export async function getStatusCounts(kioskId: string): Promise<Record<string, number>> {
  const rows = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) AS count FROM orders WHERE kiosk_id = $1 GROUP BY status`,
    [kioskId],
  );
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}
