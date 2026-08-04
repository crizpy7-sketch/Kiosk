import { requirePermission, listUsers } from "@/lib/auth/session.server";
import { getEnv } from "@/lib/env";
import { getKiosk, getSetting, listResolvedExperiences } from "@/lib/db/repositories";
import { SettingsForms } from "@/app/admin/(dashboard)/settings/SettingsForms";
import { formatDateTime, Panel } from "@/components/admin/Ui";
import { isDemoAi, isDemoPayments } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Owner-only settings.
 *
 * Note what is absent: there is no field here that displays or edits a Stripe
 * key, a Decart key, or APP_SECRET. Credentials live in the server environment
 * and are never rendered — not masked, not partially shown, not at all. Rotating
 * one is a deploy, not a web form.
 */
export default async function AdminSettingsPage() {
  await requirePermission("settings.manage");

  const env = getEnv();
  const [kiosk, experiences, users, ttlHours] = await Promise.all([
    getKiosk(env.KIOSK_ID),
    listResolvedExperiences({ includeInactive: true }),
    listUsers(),
    getSetting<number>("download_ttl_hours", env.DOWNLOAD_LINK_TTL_HOURS),
  ]);

  const currentPrice = experiences[0]?.priceCents ?? 599;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-bold text-white">Settings</h1>
        <p className="mt-1 text-[14px] text-wf-dim">Owner only.</p>
      </div>

      <SettingsForms
        currentPriceCents={currentPrice}
        currentDailyLimitSeconds={kiosk?.daily_ai_limit_seconds ?? 3600}
        currentTtlHours={ttlHours}
        users={users.map((user) => ({
          id: user.id,
          email: user.email,
          role: user.role,
          active: user.active,
          lastLoginAt: user.last_login_at ? formatDateTime(user.last_login_at) : "Never",
        }))}
      />

      <Panel title="Environment (read-only)">
        <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
          <Row label="Kiosk ID" value={env.KIOSK_ID} />
          <Row label="Payments" value={isDemoPayments() ? "DEMO — no real charges" : "LIVE — Stripe"} />
          <Row label="AI" value={isDemoAi() ? "DEMO — simulated on-device" : "LIVE — Decart"} />
          <Row label="Storage driver" value={env.STORAGE_DRIVER} />
          <Row label="Max AI session" value={`${env.SESSION_MAX_SECONDS}s`} />
          <Row label="Countdown" value={`${env.COUNTDOWN_SECONDS}s`} />
          <Row label="Default language" value={env.DEFAULT_LANGUAGE.toUpperCase()} />
          <Row label="Attract timeout" value={`${env.ATTRACT_TIMEOUT_SECONDS}s`} />
          <Row label="Kiosk last seen" value={formatDateTime(kiosk?.last_seen_at ?? null)} />
        </dl>

        <p className="mt-5 rounded-xl border border-wf-border bg-wf-ink p-4 text-[13px] leading-relaxed text-wf-dim">
          API keys and secrets are never shown here or anywhere else in this dashboard. They are read
          from the server environment only. To rotate one, change it in your host&apos;s environment
          settings and redeploy — see docs/SECURITY.md.
        </p>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-wf-border pb-2">
      <dt className="text-wf-dim">{label}</dt>
      <dd className="text-right font-mono text-[13px] text-white">{value}</dd>
    </div>
  );
}
