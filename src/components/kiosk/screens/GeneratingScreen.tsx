"use client";

import type { RefObject } from "react";
import { KioskScreen, Spinner, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language } from "@/lib/i18n/messages";

/**
 * State 6 — Countdown and live transformation.
 *
 * The transformed stream plays full-bleed; the customer is watching themselves
 * become something else, and every pixel of chrome competes with that. So: a
 * countdown ring, a shrinking time bar, and one manual capture button. Nothing
 * else.
 *
 * The remaining-time bar is not decoration. The session has a hard cap that
 * Decart enforces, and a customer who can see the clock does not feel cut off.
 */
export function GeneratingScreen({
  language,
  videoRef,
  phase,
  countdown,
  secondsLeft,
  maxSeconds,
  onCaptureNow,
}: {
  language: Language;
  videoRef: RefObject<HTMLVideoElement | null>;
  phase: "connecting" | "countdown" | "live";
  countdown: number;
  secondsLeft: number;
  maxSeconds: number;
  onCaptureNow: () => void;
}) {
  const t = createTranslator(language);
  const progress = maxSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / maxSeconds)) : 0;

  return (
    <KioskScreen testId="screen-generating" className="justify-between gap-5 px-6">
      <h1 className="wf-display pt-2 text-center text-[30px] tracking-[0.06em] text-white">
        {phase === "live" ? t("generating.transforming") : t("generating.getReady")}
      </h1>

      <div className="relative flex-1 overflow-hidden rounded-[32px] border-2 border-wf-pink/40 bg-black shadow-[0_0_60px_-16px_rgba(255,30,138,0.65)]">
        <video
          ref={videoRef}
          data-testid="generating-video"
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />

        {phase === "connecting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/80">
            <Spinner />
            <p className="text-[21px] text-white/85">{t("generating.connecting")}</p>
          </div>
        )}

        {phase === "countdown" && countdown > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <div
              key={countdown}
              className="wf-animate-pop flex h-[220px] w-[220px] items-center justify-center rounded-full border-[10px] border-wf-pink bg-black/70"
              data-testid="countdown"
            >
              <span className="wf-display text-[112px] leading-none text-white">{countdown}</span>
            </div>
          </div>
        )}

        {phase === "live" && (
          <p className="absolute inset-x-0 bottom-5 text-center text-[20px] font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
            {t("generating.holdStill")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div
          className="h-4 w-full overflow-hidden rounded-full bg-white/12"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={maxSeconds}
          aria-valuenow={secondsLeft}
          aria-label={t("generating.secondsLeft", { seconds: secondsLeft })}
        >
          <div
            className="h-full rounded-full transition-[width] duration-1000 ease-linear"
            style={{
              width: `${progress * 100}%`,
              background: "linear-gradient(90deg,#ff1e8a 0%,#b4ff1a 100%)",
            }}
            data-testid="generating-progress"
          />
        </div>

        <p className="text-center text-[19px] text-wf-dim" data-testid="generating-seconds">
          {t("generating.secondsLeft", { seconds: secondsLeft })}
        </p>

        <TouchButton onClick={onCaptureNow} disabled={phase !== "live"} data-testid="generating-capture">
          {t("generating.capture")}
        </TouchButton>
      </div>
    </KioskScreen>
  );
}
