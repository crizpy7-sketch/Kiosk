"use client";

import { WildFrameLogo } from "@/components/brand/WildFrameLogo";
import { KioskScreen, Spinner, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language } from "@/lib/i18n/messages";

/**
 * State 9 — Reset, plus the two screens the customer must never fall through:
 * a waiting state and a failure state. There is no code path in this app that
 * puts a raw error, a stack trace, or a blank screen in front of a customer.
 */

export function ThankYouScreen({ language }: { language: Language }) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-thanks" className="items-center justify-center gap-9">
      <WildFrameLogo size="lg" />

      <div className="wf-animate-pop flex h-[150px] w-[150px] items-center justify-center rounded-full border-[8px] border-wf-green">
        <span className="text-[76px] leading-none text-wf-green">✓</span>
      </div>

      <div className="text-center">
        <h1 className="wf-display text-[42px] tracking-[0.05em] text-white">{t("reset.title")}</h1>
        <p className="mt-3 text-[23px] text-white/80">{t("reset.subtitle")}</p>
      </div>

      <p className="text-[18px] text-wf-dim">{t("reset.returning")}</p>
    </KioskScreen>
  );
}

/** Shown while the server confirms payment. Never advances on its own. */
export function WaitingScreen({ language }: { language: Language }) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-waiting" className="items-center justify-center gap-8 text-center">
      <WildFrameLogo size="md" />
      <Spinner className="h-16 w-16" />
      <h1 className="wf-display text-[32px] text-white">{t("purchase.waiting")}</h1>
      <p className="max-w-[520px] text-[20px] text-wf-dim">{t("purchase.waitingHint")}</p>
    </KioskScreen>
  );
}

/**
 * The catch-all failure screen.
 *
 * `paymentProtected` is the important prop: once money has moved, the customer
 * is told so in the same breath as the apology, and the reference is on screen
 * so a staff member can find the order without asking them to repeat anything.
 */
export function ErrorScreen({
  language,
  message,
  publicReference,
  paymentProtected,
  onRetry,
  onStartOver,
}: {
  language: Language;
  message?: string;
  publicReference?: string | null;
  paymentProtected: boolean;
  onRetry?: () => void;
  onStartOver: () => void;
}) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-error" className="items-center justify-center gap-8 text-center">
      <div className="flex h-[130px] w-[130px] items-center justify-center rounded-full border-[7px] border-wf-pink">
        <span className="text-[64px] leading-none text-wf-pink">!</span>
      </div>

      <h1 className="wf-display text-[34px] text-white">{t("error.title")}</h1>

      <p className="max-w-[600px] text-[22px] leading-[1.5] text-white/85" data-testid="error-message">
        {message ?? (paymentProtected ? t("error.staff") : t("error.retry"))}
      </p>

      {publicReference && (
        <p className="wf-display rounded-xl border border-white/20 px-6 py-3 text-[22px] tracking-[0.12em] text-wf-green">
          {publicReference}
        </p>
      )}

      <div className="flex w-full max-w-[520px] flex-col gap-4">
        {onRetry && (
          <TouchButton onClick={onRetry} data-testid="error-retry">
            {t("error.retry")}
          </TouchButton>
        )}
        <TouchButton variant="secondary" size="md" onClick={onStartOver} data-testid="error-start-over">
          {t("error.startOver")}
        </TouchButton>
      </div>
    </KioskScreen>
  );
}

/** Shown when the browser reports it is offline. */
export function OfflineScreen({ language }: { language: Language }) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-offline" className="items-center justify-center gap-7 text-center">
      <span className="text-[76px]">📶</span>
      <h1 className="wf-display text-[34px] text-wf-pink">{t("error.offline.title")}</h1>
      <p className="max-w-[520px] text-[22px] text-white/85">{t("error.offline.body")}</p>
    </KioskScreen>
  );
}

/** Shown when the battery is too low to safely start a new paid session. */
export function LowBatteryScreen({ language }: { language: Language }) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-low-battery" className="items-center justify-center gap-7 text-center">
      <span className="text-[76px]">🔌</span>
      <h1 className="wf-display text-[34px] text-wf-pink">{t("kiosk.unavailable.title")}</h1>
      <p className="max-w-[520px] text-[22px] text-white/85">{t("kiosk.unavailable.body")}</p>
    </KioskScreen>
  );
}
