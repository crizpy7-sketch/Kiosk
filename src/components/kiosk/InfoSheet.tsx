"use client";

import { useEffect, useRef } from "react";
import { TouchButton } from "@/components/kiosk/Primitives";

/**
 * Modal sheet for privacy and help copy.
 *
 * Focus moves in on open and Escape closes, so the sheet is operable with a
 * keyboard or a switch device even though the expected input is a finger.
 */
export function InfoSheet({
  title,
  body,
  closeLabel,
  onClose,
}: {
  title: string;
  body: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-50 flex items-end bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="info-sheet"
    >
      <div className="wf-animate-rise max-h-[78%] w-full overflow-y-auto rounded-t-[32px] border-t-2 border-wf-pink/50 bg-wf-surface px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-9">
        <h2 className="wf-display mb-5 text-[30px] tracking-[0.1em] text-wf-pink">{title}</h2>
        <p className="mb-8 text-[21px] leading-[1.55] text-white/85">{body}</p>
        <TouchButton ref={closeRef} variant="secondary" onClick={onClose} data-testid="info-sheet-close">
          {closeLabel}
        </TouchButton>
      </div>
    </div>
  );
}
