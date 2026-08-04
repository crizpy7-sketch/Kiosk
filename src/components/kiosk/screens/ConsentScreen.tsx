"use client";

import { BackButton, KioskScreen, Spinner, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language, type MessageKey } from "@/lib/i18n/messages";

/**
 * State 4 — Consent.
 *
 * Six short lines, no scroll, no legalese, no pre-ticked box. The camera does
 * not open until the customer taps I AGREE — the browser is never asked for
 * camera permission before this point, so a passer-by cannot trigger a
 * permission prompt by idly tapping the kiosk.
 */

const POINTS: MessageKey[] = [
  "consent.point.camera",
  "consent.point.ai",
  "consent.point.delivery",
  "consent.point.raw",
  "consent.point.minors",
  "consent.point.help",
];

export function ConsentScreen({
  language,
  busy,
  onAgree,
  onBack,
}: {
  language: Language;
  busy: boolean;
  onAgree: () => void;
  onBack: () => void;
}) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-consent" className="justify-between gap-6">
      {/* min-h-0 + overflow on the list, not the screen: if this copy ever grows
          past the frame — longer translations, a smaller device — the list
          scrolls and I AGREE stays exactly where the customer's thumb is. A
          consent button that scrolls off screen is a consent button nobody can
          press. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 overflow-y-auto py-2">
        <h1 className="wf-display text-center text-[38px] tracking-[0.06em] text-white max-[520px]:text-[28px]">
          {t("consent.title")}
        </h1>

        <ul className="flex flex-col gap-5 max-[520px]:gap-3.5">
          {POINTS.map((key) => (
            <li key={key} className="flex items-start gap-4">
              <span
                aria-hidden
                className="mt-2.5 h-3 w-3 shrink-0 rounded-full bg-wf-pink"
              />
              <span className="text-[22px] leading-[1.4] text-white/92 max-[520px]:text-[16px]">
                {t(key)}
              </span>
            </li>
          ))}
        </ul>

        <p className="rounded-2xl border border-white/12 bg-white/5 px-6 py-5 text-[18px] leading-[1.45] text-wf-dim max-[520px]:px-4 max-[520px]:py-3 max-[520px]:text-[14px]">
          {t("consent.fiction")}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <TouchButton onClick={onAgree} disabled={busy} data-testid="consent-agree">
          {busy ? <Spinner className="h-8 w-8" /> : t("consent.agree")}
        </TouchButton>
        <BackButton onClick={onBack} label={t("common.back")} />
      </div>
    </KioskScreen>
  );
}
