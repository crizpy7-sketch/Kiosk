"use client";

import { useEffect, useRef, useState } from "react";
import { KioskScreen, Spinner, TouchButton } from "@/components/kiosk/Primitives";
import { createTranslator, type Language } from "@/lib/i18n/messages";

/**
 * State 5 — Camera and positioning.
 *
 * The front camera opens here and nowhere earlier. The preview is mirrored,
 * because a customer adjusting a hat expects the screen to move the same way
 * they do, and a head-and-shoulders guide tells them where to stand without
 * anyone having to explain it.
 *
 * On permission failure the customer gets a plain sentence and a route to a
 * human — never a browser error, never a stack trace.
 */
/**
 * Streams handed on to the generation step. The unmount cleanup below must stop
 * every stream it opened *except* one already passed downstream — a WeakSet
 * records that without monkey-patching MediaStream.
 */
const handedOff = new WeakSet<MediaStream>();

export function CameraScreen({
  language,
  onReady,
  onPermissionDenied,
  onCancel,
}: {
  language: Language;
  onReady: (stream: MediaStream) => void;
  onPermissionDenied: () => void;
  onCancel: () => void;
}) {
  const t = createTranslator(language);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"requesting" | "ready" | "denied">("requesting");

  useEffect(() => {
    let cancelled = false;

    async function open(): Promise<void> {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 720 },
            height: { ideal: 1280 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });

        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("denied");
          onPermissionDenied();
        }
      }
    }

    void open();

    return () => {
      cancelled = true;
      // Unmounting without handing the stream on (back button, timeout, error)
      // must release the camera — a lit camera light on an idle kiosk is both a
      // privacy problem and a support call.
      const stream = streamRef.current;
      if (stream && !handedOff.has(stream)) {
        for (const track of stream.getTracks()) track.stop();
      }
      streamRef.current = null;
    };
  }, [onPermissionDenied]);

  const handleReady = (): void => {
    const stream = streamRef.current;
    if (!stream) return;
    // Mark as owned by the generation step so the cleanup above does not stop
    // the tracks we are about to transform.
    handedOff.add(stream);
    onReady(stream);
  };

  if (state === "denied") {
    return (
      <KioskScreen testId="screen-camera-denied" className="items-center justify-center gap-8 text-center">
        <h1 className="wf-display text-[36px] text-wf-pink">{t("camera.denied.title")}</h1>
        <p className="max-w-[560px] text-[22px] leading-[1.5] text-white/85">{t("camera.denied.body")}</p>
        <TouchButton variant="secondary" onClick={onCancel} data-testid="camera-denied-back">
          {t("error.startOver")}
        </TouchButton>
      </KioskScreen>
    );
  }

  return (
    <KioskScreen testId="screen-camera" className="justify-between gap-5 px-6">
      <h1 className="wf-display pt-2 text-center text-[32px] leading-tight tracking-[0.05em] text-white">
        {t("camera.title")}
      </h1>

      <div className="relative flex-1 overflow-hidden rounded-[32px] border-2 border-white/15 bg-black">
        <video
          ref={videoRef}
          data-testid="camera-preview"
          autoPlay
          playsInline
          muted
          className="wf-mirror h-full w-full object-cover"
        />

        {/* Head-and-shoulders framing guide */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[62%] w-[74%]">
            <Corner className="left-0 top-0 border-l-4 border-t-4 rounded-tl-[28px]" />
            <Corner className="right-0 top-0 border-r-4 border-t-4 rounded-tr-[28px]" />
            <Corner className="bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[28px]" />
            <Corner className="bottom-0 right-0 border-b-4 border-r-4 rounded-br-[28px]" />
          </div>
        </div>

        {state === "requesting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/75">
            <Spinner />
            <p className="text-[20px] text-white/85">{t("camera.requesting")}</p>
          </div>
        )}
      </div>

      <p className="text-center text-[19px] leading-[1.4] text-wf-dim">{t("camera.hint")}</p>

      <TouchButton onClick={handleReady} disabled={state !== "ready"} data-testid="camera-ready">
        {t("camera.ready")}
      </TouchButton>
    </KioskScreen>
  );
}

function Corner({ className }: { className: string }) {
  return <span className={`absolute h-16 w-16 border-wf-green ${className}`} />;
}
