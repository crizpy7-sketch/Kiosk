"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttractScreen } from "@/components/kiosk/screens/AttractScreen";
import { StyleScreen } from "@/components/kiosk/screens/StyleScreen";
import { PurchaseScreen } from "@/components/kiosk/screens/PurchaseScreen";
import { ConsentScreen } from "@/components/kiosk/screens/ConsentScreen";
import { CameraScreen } from "@/components/kiosk/screens/CameraScreen";
import { GeneratingScreen } from "@/components/kiosk/screens/GeneratingScreen";
import { RevealScreen } from "@/components/kiosk/screens/RevealScreen";
import { DeliveryScreen } from "@/components/kiosk/screens/DeliveryScreen";
import {
  ErrorScreen,
  LowBatteryScreen,
  OfflineScreen,
  ThankYouScreen,
  WaitingScreen,
} from "@/components/kiosk/screens/StatusScreens";
import { DemoBadge } from "@/components/kiosk/Primitives";
import {
  useBattery,
  useHeartbeat,
  useIdleTimeout,
  useOnline,
  usePolling,
  useVisibilityFlag,
  useWakeLock,
} from "@/lib/kiosk/hooks";
import { releaseAudio } from "@/lib/kiosk/sound";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import type { PublicKioskConfig } from "@/lib/public-config";
import type { ClientSessionGrant, RealtimeSession } from "@/lib/ai/provider";
import { DecartRealtimeSession } from "@/lib/ai/realtime/decart";
import { isDemoGrant, MockRealtimeSession } from "@/lib/ai/realtime/mock";

/**
 * The kiosk state machine.
 *
 * The browser's copy of the flow is a convenience for rendering — the server
 * owns the truth. Every step that matters (paid, consented, authorized,
 * captured, delivered) is confirmed by an API call before the screen advances,
 * so a reloaded, reordered or tampered client cannot skip ahead.
 *
 * Reset is the other half of that contract: `resetSession` stops every track,
 * disconnects the provider, clears customer state and wipes the stored order.
 * It runs on completion, cancellation, timeout, error and unmount, because the
 * next customer must never see a trace of the last one.
 */

type Step =
  | "attract"
  | "style"
  | "purchase"
  | "waiting"
  | "consent"
  | "camera"
  | "generating"
  | "reveal"
  | "delivery"
  | "thanks"
  | "error";

/** Battery floors. Below `BLOCK` a new paid session is refused. */
const BATTERY_BLOCK_PERCENT = 10;

const STORAGE_KEY = "wf_active_order";

interface ActiveOrder {
  orderId: string;
  publicReference: string;
  experienceSlug: string;
  language: Language;
}

interface ErrorState {
  message?: string;
  paymentProtected: boolean;
  retry?: () => void;
}

export function KioskApp({
  config,
  resumeOrderId,
  resumeResult,
}: {
  config: PublicKioskConfig;
  resumeOrderId: string | null;
  resumeResult: "success" | "cancel" | null;
}) {
  const [language, setLanguage] = useState<Language>(config.defaultLanguage);
  const [step, setStep] = useState<Step>("attract");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [order, setOrder] = useState<ActiveOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [muted, setMuted] = useState(false);

  // Generation
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const grantRef = useRef<ClientSessionGrant | null>(null);
  const timersRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const [phase, setPhase] = useState<"connecting" | "countdown" | "live">("connecting");
  const [countdown, setCountdown] = useState(config.countdownSeconds);
  const [secondsLeft, setSecondsLeft] = useState(config.sessionMaxSeconds);

  // Reveal / delivery
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const capturedBlobRef = useRef<Blob | null>(null);
  const [canRetake, setCanRetake] = useState(true);
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [expiresInHours, setExpiresInHours] = useState(config.downloadTtlHours);

  const t = createTranslator(language);
  const online = useOnline();
  const battery = useBattery();

  useVisibilityFlag();
  useWakeLock(true);
  useHeartbeat(battery);

  const experiences = config.experiences;
  const selectedExperience = useMemo(
    () => experiences.find((e) => e.slug === selectedSlug) ?? null,
    [experiences, selectedSlug],
  );

  // ------------------------------------------------------------- teardown --

  /** Mirrors `order.id` for callbacks that must not re-create on every change. */
  const orderIdRef = useRef<string | null>(null);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearInterval(timer);
    timersRef.current = [];
  }, []);

  /** Stops the AI session and the camera. Idempotent; safe from any path. */
  const teardownGeneration = useCallback(
    (reason: "completed" | "failed" | "timeout" | "canceled", errorCode?: string) => {
      clearTimers();

      const session = sessionRef.current;
      const grant = grantRef.current;
      sessionRef.current = null;
      grantRef.current = null;

      if (!session) return;

      const billableSeconds = session.billableSeconds();
      const providerSessionId = session.providerSessionId;
      session.disconnect();

      if (grant) {
        const payload = JSON.stringify({
          status: reason,
          billableSeconds,
          providerSessionId,
          errorCode: errorCode ?? null,
        });
        const url = `/api/ai/session/${grant.generationSessionId}/end`;

        // sendBeacon survives a page the customer is walking away from, so the
        // seconds we were billed for are still booked.
        const beacon =
          typeof navigator.sendBeacon === "function" &&
          navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));

        if (!beacon) {
          void fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => undefined);
        }
      }
    },
    [clearTimers],
  );

  /** Returns the kiosk to attract mode with no residue of the last customer. */
  const resetSession = useCallback(
    (reason: "completed" | "canceled" | "timeout" = "canceled") => {
      teardownGeneration(reason === "completed" ? "completed" : "canceled");
      releaseAudio();

      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      capturedBlobRef.current = null;

      setCapturedUrl(null);
      setQrDataUri(null);
      setOrder(null);
      orderIdRef.current = null;
      setSelectedSlug(null);
      setCanRetake(true);
      setCanceled(false);
      setError(null);
      setBusy(false);
      setPhase("connecting");
      setCountdown(config.countdownSeconds);
      setSecondsLeft(config.sessionMaxSeconds);
      setLanguage(config.defaultLanguage);
      setStep("attract");

      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Private browsing / storage disabled — in-memory state is already cleared.
      }

      // Strip the order id from the URL. Returning from checkout puts it in the
      // address bar, and on a shared kiosk that means the next person inherits
      // the previous customer's order reference in plain sight.
      if (typeof window !== "undefined" && window.location.search) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    },
    [capturedUrl, config.countdownSeconds, config.defaultLanguage, config.sessionMaxSeconds, teardownGeneration],
  );

  // Unmount / page-hide: never leave a camera or a provider session running.
  useEffect(() => {
    const onPageHide = (): void => teardownGeneration("canceled");
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      teardownGeneration("canceled");
    };
  }, [teardownGeneration]);

  // Inactivity returns to attract, except while generating (the customer is
  // standing still on purpose) and on the thank-you screen (it self-advances).
  const idleEligible = step !== "attract" && step !== "generating" && step !== "thanks";
  useIdleTimeout(idleEligible, config.attractTimeoutSeconds, () => resetSession("timeout"));

  // ----------------------------------------------------------- error path --

  const failWith = useCallback(
    (message: string, paymentProtected: boolean, retry?: () => void, errorCode = "KIOSK_SESSION_FAILED") => {
      teardownGeneration("failed", errorCode);

      // Tell the server a *paid* order died here. Without this the order sits in
      // `generation_authorized` and never reaches the admin's failures list, so
      // a customer who paid and got nothing would be invisible to staff.
      const orderId = orderIdRef.current;
      if (paymentProtected && orderId) {
        void fetch(`/api/orders/${orderId}/fail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ errorCode }),
          keepalive: true,
        }).catch(() => undefined);
      }

      setError({ message, paymentProtected, ...(retry ? { retry } : {}) });
      setBusy(false);
      setStep("error");
    },
    [teardownGeneration],
  );

  // --------------------------------------------------------- persistence --

  const persistOrder = useCallback((value: ActiveOrder | null) => {
    try {
      if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Non-fatal: the flow continues, it just cannot survive a reload.
    }
  }, []);

  // ------------------------------------------------------ resume on load --

  const resumeFromServer = useCallback(
    async (active: ActiveOrder, fromCancel: boolean) => {
      const response = await fetch(`/api/orders/${active.orderId}/status`);
      if (!response.ok) {
        resetSession();
        return;
      }

      const status = (await response.json()) as {
        status: string;
        canRetake: boolean;
        publicReference: string;
      };

      setOrder(active);
      orderIdRef.current = active.orderId;
      setSelectedSlug(active.experienceSlug);
      setLanguage(active.language);
      setCanRetake(status.canRetake);

      switch (status.status) {
        case "created":
        case "payment_pending":
          setCanceled(fromCancel);
          setStep(fromCancel ? "purchase" : "waiting");
          break;
        case "paid":
          setStep("consent");
          break;
        case "consented":
        case "generation_authorized":
          setStep("camera");
          break;
        case "generating":
        case "captured":
          // The AI session did not survive the reload; the paid order can still
          // be rescued by staff, so say so rather than silently restarting.
          failWith(t("error.aiFailed"), true);
          break;
        case "completed":
        case "delivered":
          setStep("thanks");
          break;
        case "failed":
          failWith(t("error.staff"), true);
          break;
        default:
          resetSession();
      }
    },
    [failWith, resetSession, t],
  );

  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;

    let stored: ActiveOrder | null = null;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      stored = raw ? (JSON.parse(raw) as ActiveOrder) : null;
    } catch {
      stored = null;
    }

    // A return from checkout wins over stored state — the URL is the newer fact.
    if (resumeOrderId && stored?.orderId === resumeOrderId) {
      void resumeFromServer(stored, resumeResult === "cancel");
      return;
    }
    if (stored) void resumeFromServer(stored, false);
  }, [resumeFromServer, resumeOrderId, resumeResult]);

  // Poll while waiting for the payment webhook to land.
  usePolling(step === "waiting" && Boolean(order), 1500, async () => {
    if (!order) return;
    const response = await fetch(`/api/orders/${order.orderId}/status`);
    if (!response.ok) return;
    const status = (await response.json()) as { status: string };

    if (status.status === "paid") setStep("consent");
    else if (status.status === "failed") failWith(t("error.staff"), true);
    else if (status.status === "expired") resetSession();
  });

  // A payment that never confirms must not strand the customer on a spinner.
  useEffect(() => {
    if (step !== "waiting") return;
    const timer = setTimeout(() => failWith(t("error.staff"), true), 120_000);
    return () => clearTimeout(timer);
  }, [step, failWith, t]);

  // ------------------------------------------------------------ actions --

  const handleStart = useCallback(() => setStep("style"), []);

  const handleContinueToPurchase = useCallback(async () => {
    if (!selectedExperience) return;
    setBusy(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experienceSlug: selectedExperience.slug, language }),
      });
      if (!response.ok) throw new Error("order");

      const created = (await response.json()) as { orderId: string; publicReference: string };
      const active: ActiveOrder = {
        orderId: created.orderId,
        publicReference: created.publicReference,
        experienceSlug: selectedExperience.slug,
        language,
      };
      setOrder(active);
      orderIdRef.current = active.orderId;
      persistOrder(active);
      setStep("purchase");
    } catch {
      failWith(t("error.staff"), false, () => setStep("style"));
    } finally {
      setBusy(false);
    }
  }, [failWith, language, persistOrder, selectedExperience, t]);

  const handlePay = useCallback(async () => {
    if (!order) return;
    setBusy(true);
    setCanceled(false);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId }),
      });
      if (!response.ok) throw new Error("checkout");

      const { checkoutUrl } = (await response.json()) as { checkoutUrl: string };
      // Full-page redirect: the customer leaves the kiosk app and comes back to
      // /kiosk/return, which is why order state is persisted first.
      window.location.assign(checkoutUrl);
    } catch {
      setBusy(false);
      failWith(t("error.staff"), false, () => setStep("purchase"));
    }
  }, [failWith, order, t]);

  const handleConsent = useCallback(async () => {
    if (!order) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/orders/${order.orderId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreed: true }),
      });
      if (!response.ok) throw new Error("consent");
      setStep("camera");
    } catch {
      failWith(t("error.staff"), true);
    } finally {
      setBusy(false);
    }
  }, [failWith, order, t]);

  // ------------------------------------------------------- generation ----

  const runCapture = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || !order) return;

    clearTimers();
    try {
      const blob = await session.captureFrame();
      teardownGeneration("completed");

      const response = await fetch(`/api/orders/${order.orderId}/captured`, { method: "POST" });
      if (!response.ok) throw new Error("captured");
      const result = (await response.json()) as { canRetake: boolean };

      capturedBlobRef.current = blob;
      setCapturedUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
      setCanRetake(result.canRetake);
      setStep("reveal");
    } catch {
      failWith(t("error.aiFailed"), true, undefined, "AI_CAPTURE_FAILED");
    }
  }, [clearTimers, failWith, order, t, teardownGeneration]);

  const startGeneration = useCallback(
    async (stream: MediaStream, retake: boolean) => {
      if (!order || !selectedExperience) return;

      setStep("generating");
      setPhase("connecting");
      setCountdown(config.countdownSeconds);
      setSecondsLeft(config.sessionMaxSeconds);

      try {
        const response = await fetch("/api/ai/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.orderId, retake }),
        });
        if (!response.ok) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error("token");
        }

        const grant = (await response.json()) as ClientSessionGrant;
        grantRef.current = grant;

        const video = videoRef.current;
        if (!video) throw new Error("video");

        const session: RealtimeSession = isDemoGrant(grant)
          ? new MockRealtimeSession(grant, stream, video, selectedExperience.theme)
          : new DecartRealtimeSession(grant, stream, video, {
              // A mid-session provider failure lands on the same recoverable
              // screen as a connect failure: paid, unfinished, staff-rescuable.
              onError: (code) => failWith(t("error.aiFailed"), true, undefined, code),
            });

        sessionRef.current = session;
        await session.connect();

        // Countdown, then the live window.
        setPhase("countdown");
        let remaining = config.countdownSeconds;
        setCountdown(remaining);

        const countdownTimer = setInterval(() => {
          remaining -= 1;
          setCountdown(remaining);
          if (remaining > 0) return;

          clearInterval(countdownTimer);
          setPhase("live");

          let left = Math.min(config.sessionMaxSeconds, grant.maxSessionSeconds);
          setSecondsLeft(left);

          const liveTimer = setInterval(() => {
            left -= 1;
            setSecondsLeft(left);
            // Capture automatically at the cap so the customer always gets the
            // photo they paid for, even if they never tap the button.
            if (left <= 0) {
              clearInterval(liveTimer);
              void runCapture();
            }
          }, 1000);
          timersRef.current.push(liveTimer);
        }, 1000);
        timersRef.current.push(countdownTimer);
      } catch {
        failWith(t("error.aiFailed"), true, undefined, "AI_CONNECT_FAILED");
      }
    },
    [config.countdownSeconds, config.sessionMaxSeconds, failWith, order, runCapture, selectedExperience, t],
  );

  const handleRetake = useCallback(async () => {
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      });
      setCanRetake(false);
      await startGeneration(stream, true);
    } catch {
      failWith(t("error.aiFailed"), true);
    } finally {
      setBusy(false);
    }
  }, [failWith, startGeneration, t]);

  const handleAccept = useCallback(async () => {
    const blob = capturedBlobRef.current;
    if (!order || !blob) return;

    setBusy(true);
    setStep("delivery");
    try {
      const form = new FormData();
      form.append("image", blob, "final.jpg");

      const response = await fetch(`/api/orders/${order.orderId}/capture`, { method: "POST", body: form });
      if (!response.ok) throw new Error("upload");

      const delivery = (await response.json()) as { qrDataUri: string; expiresInHours: number };
      setQrDataUri(delivery.qrDataUri);
      setExpiresInHours(delivery.expiresInHours);
    } catch {
      failWith(t("error.staff"), true, undefined, "UPLOAD_FAILED");
    } finally {
      setBusy(false);
    }
  }, [failWith, order, t]);

  const handleDone = useCallback(() => {
    setStep("thanks");
    setTimeout(() => resetSession("completed"), 4000);
  }, [resetSession]);

  // ------------------------------------------------------------- render --

  const batteryBlocked =
    battery.supported &&
    battery.level !== null &&
    battery.level < BATTERY_BLOCK_PERCENT &&
    battery.charging === false;

  if (!online && step !== "generating") return <Shell demo={config.demoMode} t={t}><OfflineScreen language={language} /></Shell>;
  if (batteryBlocked && step === "attract") {
    return <Shell demo={config.demoMode} t={t}><LowBatteryScreen language={language} /></Shell>;
  }

  return (
    <Shell demo={config.demoMode} t={t}>
      {step === "attract" && (
        <AttractScreen
          config={config}
          language={language}
          onLanguageChange={setLanguage}
          onStart={handleStart}
        />
      )}

      {step === "style" && (
        <StyleScreen
          experiences={experiences}
          language={language}
          selectedSlug={selectedSlug}
          onSelect={setSelectedSlug}
          onContinue={() => void handleContinueToPurchase()}
          onBack={() => resetSession()}
        />
      )}

      {step === "purchase" && (
        <PurchaseScreen
          language={language}
          priceCents={selectedExperience?.priceCents ?? config.priceCents}
          currency={config.currency}
          busy={busy}
          demoMode={config.demoMode}
          canceled={canceled}
          onPay={() => void handlePay()}
          onBack={() => setStep("style")}
        />
      )}

      {step === "waiting" && <WaitingScreen language={language} />}

      {step === "consent" && (
        <ConsentScreen
          language={language}
          busy={busy}
          onAgree={() => void handleConsent()}
          onBack={() => resetSession()}
        />
      )}

      {step === "camera" && (
        <CameraScreen
          language={language}
          onReady={(stream) => void startGeneration(stream, false)}
          onPermissionDenied={() => {
            const orderId = orderIdRef.current;
            if (!orderId) return;
            void fetch(`/api/orders/${orderId}/fail`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ errorCode: "CAMERA_PERMISSION_DENIED" }),
              keepalive: true,
            }).catch(() => undefined);
          }}
          onCancel={() => resetSession()}
        />
      )}

      {/* Kept mounted across reveal so the <video> element the provider writes
          into is never torn down mid-session by a re-render. */}
      <div className={step === "generating" ? "contents" : "hidden"} aria-hidden={step !== "generating"}>
        <GeneratingScreen
          language={language}
          videoRef={videoRef}
          phase={phase}
          countdown={countdown}
          secondsLeft={secondsLeft}
          maxSeconds={config.sessionMaxSeconds}
          onCaptureNow={() => void runCapture()}
        />
      </div>

      {step === "reveal" && (
        <RevealScreen
          language={language}
          imageUrl={capturedUrl}
          styleName={selectedExperience?.name[language] ?? ""}
          canRetake={canRetake}
          busy={busy}
          muted={muted}
          onToggleMute={() => setMuted((value) => !value)}
          onAccept={() => void handleAccept()}
          onRetake={() => void handleRetake()}
        />
      )}

      {step === "delivery" && (
        <DeliveryScreen
          language={language}
          qrDataUri={qrDataUri}
          expiresInHours={expiresInHours}
          onDone={handleDone}
        />
      )}

      {step === "thanks" && <ThankYouScreen language={language} />}

      {step === "error" && (
        <ErrorScreen
          language={language}
          {...(error?.message ? { message: error.message } : {})}
          publicReference={order?.publicReference ?? null}
          paymentProtected={error?.paymentProtected ?? false}
          {...(error?.retry ? { onRetry: error.retry } : {})}
          onStartOver={() => resetSession()}
        />
      )}
    </Shell>
  );
}

function Shell({
  children,
  demo,
  t,
}: {
  children: React.ReactNode;
  demo: boolean;
  t: ReturnType<typeof createTranslator>;
}) {
  useEffect(() => {
    document.body.dataset["kiosk"] = "true";
    return () => {
      delete document.body.dataset["kiosk"];
    };
  }, []);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-wf-black">
      {demo && <DemoBadge label={t("purchase.demoBadge")} />}
      {children}
    </main>
  );
}
