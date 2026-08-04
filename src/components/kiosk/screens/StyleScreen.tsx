"use client";

import Image from "next/image";
import { BackButton, KioskScreen, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import type { PublicExperience } from "@/lib/public-config";

/**
 * State 2 — Choose Style.
 *
 * Four cards, 2×2, each roughly a third of the screen: previews do the selling,
 * not copy. There is no prompt field and no hidden control — the four cards are
 * the entire vocabulary of this product, which is what keeps a supervised kiosk
 * safe without a moderation pipeline.
 */

const THEME_STYLES: Record<
  PublicExperience["theme"],
  { label: string; ring: string; glow: string; badge: string }
> = {
  slime: {
    label: "text-wf-green",
    ring: "ring-wf-green",
    glow: "shadow-[0_0_44px_-6px_rgba(180,255,26,0.75)]",
    badge: "bg-wf-green text-black",
  },
  anime: {
    label: "text-[#7fc4ff]",
    ring: "ring-[#2e8bff]",
    glow: "shadow-[0_0_44px_-6px_rgba(46,139,255,0.75)]",
    badge: "bg-[#2e8bff] text-white",
  },
  royal: {
    label: "text-wf-gold",
    ring: "ring-wf-gold",
    glow: "shadow-[0_0_44px_-6px_rgba(242,193,78,0.75)]",
    badge: "bg-wf-gold text-black",
  },
  baby: {
    label: "text-wf-baby",
    ring: "ring-wf-pink",
    glow: "shadow-[0_0_44px_-6px_rgba(255,30,138,0.75)]",
    badge: "bg-wf-pink text-white",
  },
};

export function StyleScreen({
  experiences,
  language,
  selectedSlug,
  onSelect,
  onContinue,
  onBack,
}: {
  experiences: PublicExperience[];
  language: Language;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const t = createTranslator(language);

  return (
    <KioskScreen testId="screen-style" className="gap-6">
      <header className="pt-2 text-center">
        <h1 className="wf-display text-[38px] tracking-[0.08em] text-white">{t("style.title")}</h1>
      </header>

      <div
        className="grid flex-1 grid-cols-2 grid-rows-2 gap-5"
        role="radiogroup"
        aria-label={t("style.title")}
      >
        {experiences.map((experience) => {
          const theme = THEME_STYLES[experience.theme];
          const selected = selectedSlug === experience.slug;

          return (
            <button
              key={experience.slug}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(experience.slug)}
              data-testid={`style-card-${experience.slug}`}
              data-selected={selected}
              className={[
                "group relative flex flex-col overflow-hidden rounded-3xl border-2 text-left transition-transform duration-150 active:scale-[0.985]",
                selected
                  ? `border-transparent ring-4 ${theme.ring} ${theme.glow}`
                  : "border-white/12",
              ].join(" ")}
            >
              <Image
                src={experience.previewAsset}
                alt=""
                width={400}
                height={500}
                priority
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* Legibility scrim under the label — the previews are bright. */}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black via-black/80 to-transparent"
              />

              {experience.featured && (
                <span
                  className={`wf-display absolute right-3 top-3 rounded-full px-4 py-1.5 text-[16px] tracking-[0.1em] ${theme.badge}`}
                >
                  {t("style.new")}
                </span>
              )}

              {selected && (
                <span
                  className="wf-animate-pop absolute left-3 top-3 flex h-12 w-12 items-center justify-center rounded-full bg-wf-pink text-[26px] text-white"
                  aria-label={t("style.selected")}
                >
                  ✓
                </span>
              )}

              <span className="relative mt-auto px-4 pb-5">
                <span
                  className={`wf-display block text-[27px] leading-[1.06] tracking-[0.03em] ${theme.label}`}
                >
                  {experience.name[language]}
                </span>
                <span className="mt-1 block text-[17px] text-white/80">
                  {experience.tagline[language]}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 max-[520px]:gap-2">
        <BackButton onClick={onBack} label={t("common.back")} />
        <TouchButton
          onClick={onContinue}
          disabled={!selectedSlug}
          data-testid="style-continue"
          className="flex-1"
        >
          {t("style.continue")}
        </TouchButton>
      </div>

      {!selectedSlug && (
        <p className="-mt-2 text-center text-[17px] text-wf-dim">{t("style.selectPrompt")}</p>
      )}
    </KioskScreen>
  );
}
