"use client";

import { KioskScreen, Spinner, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language } from "@/lib/i18n/messages";

/**
 * State 8 — Delivery.
 *
 * A very large QR on white — a phone camera has to lock onto this from arm's
 * length in shop lighting, so the code gets the screen and the copy gets out of
 * the way. The expiry is stated plainly rather than buried: the customer should
 * know the link dies in a day before they walk out.
 *
 * The QR is a server-rendered data URI. No third party is told the delivery URL.
 */
export function DeliveryScreen({
  language,
  qrDataUri,
  expiresInHours,
  onDone,
}: {
  language: Language;
  qrDataUri: string | null;
  expiresInHours: number;
  onDone: () => void;
}) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-delivery" className="justify-between gap-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="text-center">
          <h1 className="wf-display text-[42px] leading-tight tracking-[0.04em] text-wf-green drop-shadow-[0_0_30px_rgba(180,255,26,0.45)]">
            {t("delivery.title")}
          </h1>
          <p className="mt-4 text-[23px] text-white/85">{t("delivery.subtitle")}</p>
        </div>

        <div className="rounded-[28px] bg-white p-6 shadow-[0_0_70px_-14px_rgba(255,255,255,0.4)]">
          {qrDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URI needs no optimisation pipeline
            <img
              src={qrDataUri}
              alt={t("delivery.subtitle")}
              width={440}
              height={440}
              data-testid="delivery-qr"
              className="h-[440px] w-[440px]"
            />
          ) : (
            <div className="flex h-[440px] w-[440px] items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>

        <p className="text-[20px] text-wf-dim" data-testid="delivery-expiry">
          {t("delivery.expires", { hours: expiresInHours })}
        </p>
      </div>

      <TouchButton onClick={onDone} data-testid="delivery-done">
        {t("delivery.done")}
      </TouchButton>
    </KioskScreen>
  );
}
