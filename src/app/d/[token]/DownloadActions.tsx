"use client";

import { useEffect, useState } from "react";

/**
 * Download and share for the customer's phone.
 *
 * Share is only offered when `navigator.canShare` says the browser will actually
 * accept the file — an offered button that then fails is worse than no button.
 * Nothing is posted anywhere: the image goes to the OS share sheet, and the
 * customer decides where it goes from there.
 */
export function DownloadActions({ imageUrl }: { imageUrl: string }) {
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Probe with a representative file rather than trusting `share` alone.
    const probe = new File([new Blob([new Uint8Array([0xff, 0xd8, 0xff])])], "wild-frame-ai.jpg", {
      type: "image/jpeg",
    });
    setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }));
  }, []);

  async function share(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], "wild-frame-ai.jpg", { type: blob.type || "image/jpeg" });
      await navigator.share({ files: [file], title: "Wild Frame AI" });
    } catch {
      // Cancelled or unsupported — the download button below always works.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full max-w-[520px] flex-col gap-3">
      <a
        href={imageUrl}
        download="wild-frame-ai.jpg"
        className="wf-display flex min-h-[68px] items-center justify-center rounded-2xl bg-wf-pink text-[22px] text-white active:bg-wf-pink-deep"
        data-testid="download-button"
      >
        DOWNLOAD PHOTO
      </a>

      {canShare && (
        <button
          type="button"
          onClick={() => void share()}
          disabled={busy}
          className="wf-display flex min-h-[68px] items-center justify-center rounded-2xl border-2 border-white/30 text-[22px] text-white disabled:opacity-50 active:bg-white/10"
          data-testid="share-button"
        >
          SHARE
        </button>
      )}
    </div>
  );
}
