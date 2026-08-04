"use client";

import { useState } from "react";
import { WildFrameLogo } from "@/components/brand/WildFrameLogo";
import { KioskScreen, PoweredByLucy, TouchButton } from "@/components/kiosk/Primitives";
import { InfoSheet } from "@/components/kiosk/InfoSheet";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { formatPrice, type PublicKioskConfig } from "@/lib/public-config";

/**
 * State 1 — Attract.
 *
 * No camera, no AI session, no network chatter. Just the wordmark, the offer,
 * one enormous primary action, and both languages one tap away. Everything that
 * moves is transform/opacity only, and it pauses when the tab is hidden.
 */
export function AttractScreen({
  config,
  language,
  onLanguageChange,
  onStart,
}: {
  config: PublicKioskConfig;
  language: Language;
  onLanguageChange: (language: Language) => void;
  onStart: () => void;
}) {
  const t = createTranslator(language);
  const [sheet, setSheet] = useState<"privacy" | "help" | null>(null);
  const price = formatPrice(config.priceCents, config.currency);

  return (
    <KioskScreen testId="screen-attract" className="justify-between">
      {/* Ambient brand glow — the only decoration on an otherwise black slab. */}
      <div
        aria-hidden
        className="wf-animate-glow pointer-events-none absolute left-1/2 top-[22%] -z-10 h-[560px] w-[560px] -translate-x-1/2 rounded-full opacity-60 blur-[110px]"
        style={{ background: "radial-gradient(circle, #ff1e8a 0%, #7a0a44 45%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="wf-animate-glow pointer-events-none absolute bottom-[16%] left-1/2 -z-10 h-[380px] w-[380px] -translate-x-1/2 rounded-full opacity-30 blur-[110px]"
        style={{ background: "radial-gradient(circle, #b4ff1a 0%, transparent 68%)" }}
      />

      {/* The wordmark scales with the slab, so the composition fills a portrait
          iPad instead of floating a small graphic in a field of black. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        <WildFrameLogo size="xl" className="wf-animate-rise" />

        <h1 className="wf-display wf-animate-rise text-center text-[44px] leading-[1.08] tracking-[0.01em] text-white max-[520px]:text-[28px]">
          {t("brand.tagline")}
        </h1>

        <p className="wf-display rounded-full border border-wf-green/40 px-7 py-3 text-center text-[22px] tracking-[0.14em] text-wf-green max-[520px]:px-4 max-[520px]:py-2 max-[520px]:text-[13px]">
          {t("attract.offer")}
        </p>
      </div>

      <div className="flex w-full flex-col items-center gap-5 pb-2">
        <TouchButton
          onClick={onStart}
          data-testid="attract-start"
          className="relative overflow-hidden text-[38px]"
        >
          {/* Sheen sweep — reads as "alive" from across a shop floor. Feathered
              at both edges so it never looks like a two-tone button mid-sweep. */}
          <span
            aria-hidden
            className="wf-animate-sheen pointer-events-none absolute inset-y-0 w-1/4 skew-x-[-18deg]"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.32) 50%, transparent 100%)",
            }}
          />
          <span className="relative">
            {t("attract.start")} • {price}
          </span>
        </TouchButton>

        <TouchButton
          variant="secondary"
          onClick={() => {
            onLanguageChange(language === "en" ? "es" : "en");
          }}
          data-testid="attract-language-toggle"
          className="text-[26px]"
        >
          {language === "en" ? "EMPEZAR" : "START"} • {price}
        </TouchButton>

        <PoweredByLucy label={t("brand.poweredBy")} className="pt-2" />

        <nav
          className="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-0 pt-1"
          aria-label="Kiosk information"
        >
          <FooterLink
            active={language === "en"}
            onClick={() => onLanguageChange("en")}
            testId="lang-en"
          >
            {t("attract.languageEnglish")}
          </FooterLink>
          <Divider />
          <FooterLink
            active={language === "es"}
            onClick={() => onLanguageChange("es")}
            testId="lang-es"
          >
            {t("attract.languageSpanish")}
          </FooterLink>
          <Divider />
          <FooterLink onClick={() => setSheet("privacy")} testId="attract-privacy">
            {t("attract.privacy")}
          </FooterLink>
          <Divider />
          <FooterLink onClick={() => setSheet("help")} testId="attract-help">
            {t("attract.help")}
          </FooterLink>
        </nav>
      </div>

      {sheet && (
        <InfoSheet
          title={t(sheet === "privacy" ? "privacy.title" : "help.title")}
          body={t(sheet === "privacy" ? "privacy.body" : "help.body")}
          closeLabel={t("common.close")}
          onClose={() => setSheet(null)}
        />
      )}
    </KioskScreen>
  );
}

function FooterLink({
  children,
  onClick,
  active = false,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      // 60px tall despite looking like small text: the tap target is generous
      // even though the label is not.
      className={`wf-display min-h-[60px] rounded-lg px-4 text-[15px] tracking-[0.14em] transition-colors active:bg-white/10 max-[520px]:px-2.5 max-[520px]:text-[12px] max-[520px]:tracking-[0.08em] ${
        active ? "text-wf-green" : "text-wf-dim"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  // Hidden once the row wraps — a separator stranded at the end of a line reads
  // as a rendering mistake rather than as punctuation.
  return <span aria-hidden className="h-4 w-px bg-white/20 max-[520px]:hidden" />;
}
