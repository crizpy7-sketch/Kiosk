"use client";

import { AiProviderError } from "@/lib/ai/provider";

/**
 * Grabs the current frame of a <video> as a JPEG.
 *
 * The canvas is created, used and dropped inside this call. Holding one across
 * sessions is how a kiosk that runs for eight hours ends up with a slow leak,
 * and the allocation cost is irrelevant at one frame per customer.
 */
export async function captureVideoFrame(video: HTMLVideoElement, quality = 0.92): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new AiProviderError("AI_CAPTURE_FAILED", "No video frame available to capture.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new AiProviderError("AI_CAPTURE_FAILED", "Canvas is unavailable.");

  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );

  // Free the backing store immediately rather than waiting on the GC.
  canvas.width = 0;
  canvas.height = 0;

  if (!blob) throw new AiProviderError("AI_CAPTURE_FAILED", "Could not encode the captured frame.");
  return blob;
}
