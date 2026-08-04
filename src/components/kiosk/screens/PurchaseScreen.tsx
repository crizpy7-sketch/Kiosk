"use client";

import { BackButton, KioskScreen, Spinner, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { formatPrice } from "@/lib/public-config";

/**
 * State 3 — Purchase.
 *
 * One product, one price, one button. The wallet marks are shown because that
 * is what the customer will actually see on the Stripe Checkout page a moment
 * later — they are a promise about the next screen, not payment controls, so
 * they are explicitly non-interactive and hidden from assistive tech.
 */
export function PurchaseScreen({
  language,
  priceCents,
  currency,
  busy,
  demoMode,
  canceled,
  onPay,
  onBack,
}: {
  language: Language;
  priceCents: number;
  currency: string;
  busy: boolean;
  demoMode: boolean;
  canceled: boolean;
  onPay: () => void;
  onBack: () => void;
}) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-purchase" className="justify-between">
      {/* Same pattern as the consent screen: the offer block flexes and scrolls
          if it has to, so PAY NOW is never the thing pushed off the bottom. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto max-[520px]:gap-4">
        <div className="text-center">
          <h1 className="wf-display text-[40px] tracking-[0.06em] text-white max-[520px]:text-[26px]">
            {t("purchase.title")}
          </h1>
          <p className="wf-display mt-2 text-[23px] tracking-[0.18em] text-wf-dim max-[520px]:mt-1 max-[520px]:text-[15px]">
            {t("purchase.subtitle")}
          </p>
        </div>

        <p
          className="wf-display text-[104px] leading-none text-wf-green drop-shadow-[0_0_36px_rgba(180,255,26,0.45)] max-[520px]:text-[62px]"
          data-testid="purchase-price"
        >
          {formatPrice(priceCents, currency)}
        </p>

        <p className="text-[21px] text-wf-dim max-[520px]:text-[15px]">{t("purchase.oneTime")}</p>

        {/* Decorative — a promise about the Stripe page that comes next. First
            thing to go when the screen is too short to hold everything. */}
        <div aria-hidden className="flex w-full max-w-[420px] flex-col gap-3 max-[520px]:gap-1.5 max-[700px]:hidden">
          <WalletMark label=" Pay" className="bg-white text-black" />
          <WalletMark label="G Pay" className="bg-white text-black" />
          <WalletMark label="Card" className="border border-white/25 bg-wf-surface-2 text-white" />
        </div>

        {canceled && (
          <p
            className="rounded-2xl border border-wf-pink/50 bg-wf-pink/10 px-6 py-4 text-center text-[19px] text-white max-[520px]:px-4 max-[520px]:py-2.5 max-[520px]:text-[15px]"
            role="status"
            data-testid="purchase-canceled"
          >
            {t("purchase.canceled")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {demoMode && (
          <p className="wf-display text-center text-[16px] tracking-[0.16em] text-wf-green">
            {t("purchase.demoBadge")}
          </p>
        )}

        <TouchButton onClick={onPay} disabled={busy} data-testid="purchase-pay">
          {busy ? (
            <>
              <Spinner className="h-8 w-8" />
              <span className="text-[24px]">{t("purchase.preparing")}</span>
            </>
          ) : demoMode ? (
            t("purchase.demoPay")
          ) : (
            `${t("purchase.pay")} • ${formatPrice(priceCents, currency)}`
          )}
        </TouchButton>

        <p className="text-center text-[16px] text-wf-dim max-[520px]:text-[13px]">{t("purchase.secure")}</p>

        <BackButton onClick={onBack} label={t("common.back")} />
      </div>
    </KioskScreen>
  );
}

function WalletMark({ label, className }: { label: string; className: string }) {
  return (
    <div
      className={`flex h-[58px] items-center justify-center rounded-xl text-[21px] font-semibold max-[520px]:h-[42px] max-[520px]:text-[16px] ${className}`}
    >
      {label}
    </div>
  );
}
