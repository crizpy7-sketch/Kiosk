"use client";

import { forwardRef, useCallback, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Touch primitives for the kiosk.
 *
 * Two rules drive everything here:
 *   - Every interactive target is at least 64px tall (well past the 44pt iPadOS
 *     minimum) because customers tap this while standing, often with a child on
 *     one hip.
 *   - No hover-only affordances. A pointer never touches this screen.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-wf-pink text-white shadow-[0_10px_36px_-8px_rgba(255,30,138,0.75)] active:bg-wf-pink-deep",
  secondary:
    "bg-transparent text-white border-2 border-white/35 active:bg-white/10",
  ghost: "bg-white/5 text-wf-dim border border-white/10 active:bg-white/10",
  danger: "bg-transparent text-wf-pink border-2 border-wf-pink/60 active:bg-wf-pink/10",
};

interface TouchButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "lg";
  fullWidth?: boolean;
  children: ReactNode;
}

/**
 * A button that cannot be double-submitted.
 *
 * iPadOS fires a click for a fast double-tap, and a customer who taps "PAY NOW"
 * twice must not open two checkout sessions. The 700ms guard is local to the
 * element and belt-and-braces with the server-side compare-and-set.
 */
export const TouchButton = forwardRef<HTMLButtonElement, TouchButtonProps>(function TouchButton(
  { variant = "primary", size = "lg", fullWidth = true, className = "", onClick, children, ...rest },
  ref,
) {
  const lastClickRef = useRef(0);

  const handleClick = useCallback<NonNullable<TouchButtonProps["onClick"]>>(
    (event) => {
      const now = Date.now();
      if (now - lastClickRef.current < 700) {
        event.preventDefault();
        return;
      }
      lastClickRef.current = now;
      onClick?.(event);
    },
    [onClick],
  );

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      className={[
        "wf-display rounded-2xl transition-transform duration-100",
        "active:scale-[0.975] disabled:opacity-40 disabled:pointer-events-none",
        "flex items-center justify-center gap-3 text-center",
        size === "lg" ? "min-h-[86px] px-10 text-[30px]" : "min-h-[64px] px-7 text-[21px]",
        fullWidth ? "w-full" : "",
        VARIANTS[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Full-bleed portrait screen. Every kiosk state renders inside one of these. */
export function KioskScreen({
  children,
  className = "",
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={[
        "absolute inset-0 flex flex-col",
        // Safe areas keep the primary action clear of the home indicator when
        // the iPad runs this full-screen from the Home Screen.
        "px-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]",
        className,
      ].join(" ")}
    >
      {children}
    </section>
  );
}

/** Back affordance. Always rendered when a back path exists — never hidden. */
export function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="wf-display min-h-[64px] min-w-[140px] rounded-xl border border-white/20 px-6 text-[19px] text-wf-dim transition-transform active:scale-[0.97] active:bg-white/10"
    >
      ← {label}
    </button>
  );
}

/** Indeterminate spinner used while waiting on the network. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`wf-animate-spin inline-block h-10 w-10 rounded-full border-4 border-white/20 border-t-wf-pink ${className}`}
    />
  );
}

/** "POWERED BY LUCY" — the technology attribution, present on every screen. */
export function PoweredByLucy({ label, className = "" }: { label: string; className?: string }) {
  return (
    <p className={`wf-display text-[15px] tracking-[0.22em] text-wf-pink ${className}`}>{label}</p>
  );
}

/** Staff-visible demo indicator. Deliberately impossible to miss. */
export function DemoBadge({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-50 -translate-x-1/2">
      <span className="wf-display rounded-full border-2 border-wf-green bg-black/90 px-5 py-1.5 text-[13px] tracking-[0.2em] text-wf-green">
        {label}
      </span>
    </div>
  );
}
