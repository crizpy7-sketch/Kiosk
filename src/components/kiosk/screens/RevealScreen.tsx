"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { KioskScreen, Spinner, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { playRevealChime } from "@/lib/kiosk/sound";

/**
 * State 7 — Reveal.
 *
 * The emotional payoff. A brief black beat, then the portrait arrives full
 * bleed with a chime. The delay is deliberate: an instant swap reads as a page
 * transition, a held beat reads as a reveal.
 *
 * "RETAKE ONCE" disappears the moment it is spent — there is no way back to it,
 * because the second session was never paid for.
 */
export function RevealScreen({
  language,
  imageUrl,
  styleName,
  canRetake,
  busy,
  muted,
  onToggleMute,
  onAccept,
  onRetake,
}: {
  language: Language;
  imageUrl: string | null;
  styleName: string;
  canRetake: boolean;
  busy: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onAccept: () => void;
  onRetake: () => void;
}) {
  const t = createTranslator(language);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setRevealed(true);
      if (!muted) void playRevealChime();
    }, 620);
    return () => clearTimeout(timer);
    // Intentionally runs once per mount: the beat belongs to the reveal, not to
    // later mute toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <KioskScreen testId="screen-reveal" className="justify-between gap-5 px-6">
      <div className="flex items-center justify-between pt-2">
        <h1 className="wf-display text-[32px] tracking-[0.06em] text-white">{t("reveal.title")}</h1>
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={t(muted ? "reveal.unmute" : "reveal.mute")}
          data-testid="reveal-mute"
          className="flex h-[64px] w-[64px] items-center justify-center rounded-full border border-white/20 text-[26px] active:bg-white/10"
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-[32px] border-2 border-wf-green/50 bg-black shadow-[0_0_70px_-18px_rgba(180,255,26,0.7)]">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={styleName}
            fill
            unoptimized
            data-testid="reveal-image"
            className={`object-cover transition-all duration-700 ${
              revealed ? "scale-100 opacity-100" : "scale-105 opacity-0"
            }`}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}

        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/85 to-transparent"
        />
        <p className="wf-display absolute bottom-5 left-0 right-0 text-center text-[26px] tracking-[0.08em] text-wf-green">
          {styleName}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <TouchButton onClick={onAccept} disabled={busy || !imageUrl} data-testid="reveal-accept">
          {busy ? <Spinner className="h-8 w-8" /> : t("reveal.love")}
        </TouchButton>

        {canRetake ? (
          <TouchButton
            variant="secondary"
            size="md"
            onClick={onRetake}
            disabled={busy}
            data-testid="reveal-retake"
          >
            {t("reveal.retake")}
          </TouchButton>
        ) : (
          <p className="text-center text-[17px] text-wf-dim" data-testid="reveal-retake-used">
            {t("reveal.retakeUsed")}
          </p>
        )}
      </div>
    </KioskScreen>
  );
}
