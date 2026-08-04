"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Device-level kiosk concerns: screen wake, battery, connectivity, visibility
 * and heartbeat. Each is best-effort — none of these APIs is guaranteed on
 * iPadOS Safari, and the flow must work identically where they are missing.
 */

// ---------------------------------------------------------------- wake lock --

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

/**
 * Holds a Screen Wake Lock while the kiosk is open, and re-acquires it after
 * the tab is backgrounded (iPadOS drops the lock on visibility change).
 * Released on unmount so leaving kiosk mode lets the iPad sleep normally.
 */
export function useWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const nav = navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;

    let cancelled = false;

    const acquire = async (): Promise<void> => {
      try {
        const sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Denied or unsupported: the iPad's own auto-lock setting takes over.
        // Documented in the staff runbook as a Settings step.
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === "visible" && !sentinelRef.current?.released) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinelRef.current?.release().catch(() => undefined);
      sentinelRef.current = null;
    };
  }, [enabled]);
}

// ------------------------------------------------------------------ battery --

export interface BatteryState {
  supported: boolean;
  level: number | null;
  charging: boolean | null;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

/**
 * Battery Status API. Unsupported in Safari — the admin then shows "unknown"
 * rather than a made-up number, and the low-battery guard simply does not fire.
 */
export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({ supported: false, level: null, charging: null });

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery) return;

    let battery: BatteryManagerLike | null = null;
    let cancelled = false;

    const update = (): void => {
      if (!battery || cancelled) return;
      setState({ supported: true, level: Math.round(battery.level * 100), charging: battery.charging });
    };

    void nav
      .getBattery()
      .then((manager) => {
        if (cancelled) return;
        battery = manager;
        manager.addEventListener("levelchange", update);
        manager.addEventListener("chargingchange", update);
        update();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, []);

  return state;
}

// ------------------------------------------------------------------- online --

export function useOnline(): boolean {
  // Starts true so the first paint never flashes an offline screen before the
  // browser has told us anything.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

// --------------------------------------------------------------- visibility --

/** Mirrors tab visibility onto <body data-visible> so CSS can pause animation. */
export function useVisibilityFlag(): void {
  useEffect(() => {
    const update = (): void => {
      document.body.dataset["visible"] = document.visibilityState === "visible" ? "true" : "false";
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      delete document.body.dataset["visible"];
    };
  }, []);
}

// ---------------------------------------------------------------- heartbeat --

/** Posts liveness and battery to the server so the admin can see kiosk health. */
export function useHeartbeat(battery: BatteryState, intervalMs = 30_000): void {
  const batteryRef = useRef(battery);
  batteryRef.current = battery;

  useEffect(() => {
    const send = (): void => {
      const current = batteryRef.current;
      void fetch("/api/kiosk/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batteryPercent: current.level,
          batteryCharging: current.charging,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };

    send();
    const timer = setInterval(send, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}

// ------------------------------------------------------------- idle timeout --

/**
 * Returns the kiosk to attract mode after inactivity. Any touch anywhere resets
 * the clock, so a customer reading the consent screen slowly is never dumped
 * back to the start mid-sentence.
 */
export function useIdleTimeout(enabled: boolean, seconds: number, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled || seconds <= 0) return;

    let timer: ReturnType<typeof setTimeout>;

    const reset = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), seconds * 1000);
    };

    reset();
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, reset, { passive: true });

    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, reset);
    };
  }, [enabled, seconds]);
}

// ----------------------------------------------------------------- polling --

/** Polls `fn` on an interval while `enabled`, without overlapping runs. */
export function usePolling(enabled: boolean, intervalMs: number, fn: () => Promise<void>): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      try {
        await fnRef.current();
      } catch {
        // Transient failures are expected while a webhook is in flight; the
        // next tick retries and the surrounding screen keeps its own timeout.
      }
      if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
    };

    timer = setTimeout(() => void tick(), intervalMs);

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}

/** Stable callback identity for values captured in long-lived effects. */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: never[]) => ref.current(...args)) as T, []);
}
