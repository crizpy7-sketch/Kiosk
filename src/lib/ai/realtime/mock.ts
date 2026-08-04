"use client";

import type { RealtimeSession } from "@/lib/ai/provider";
import type { ClientSessionGrant } from "@/lib/ai/provider";
import { captureVideoFrame } from "@/lib/ai/realtime/capture";

/**
 * Demo realtime session.
 *
 * Renders the camera through a canvas with a per-style colour treatment and
 * publishes the result via `canvas.captureStream()`. The customer sees a real,
 * live, visibly transformed video — so the reveal, the retake and the capture
 * all exercise the same code paths as production — while no frame leaves the
 * device and no Decart credit is spent.
 *
 * The effect is deliberately a stylised colour grade, not an impersonation of
 * what Lucy produces: staff demoing this should never be able to mistake it for
 * the real model's output.
 */

type ThemeName = "slime" | "anime" | "royal" | "baby";

interface ThemeStyle {
  filter: string;
  tint: string;
  tintAlpha: number;
  vignette: [string, string];
}

const THEMES: Record<ThemeName, ThemeStyle> = {
  slime: {
    filter: "saturate(220%) contrast(125%) hue-rotate(290deg)",
    tint: "#ff1e8a",
    tintAlpha: 0.28,
    vignette: ["rgba(180,255,26,0.18)", "rgba(20,0,12,0.85)"],
  },
  anime: {
    filter: "saturate(180%) contrast(140%) brightness(108%) hue-rotate(190deg)",
    tint: "#2e8bff",
    tintAlpha: 0.3,
    vignette: ["rgba(120,200,255,0.2)", "rgba(2,6,18,0.85)"],
  },
  royal: {
    filter: "sepia(55%) saturate(160%) contrast(115%) brightness(104%)",
    tint: "#f2c14e",
    tintAlpha: 0.24,
    vignette: ["rgba(255,220,150,0.16)", "rgba(12,8,2,0.88)"],
  },
  baby: {
    filter: "saturate(150%) brightness(118%) contrast(95%) blur(0.4px)",
    tint: "#ffb3d1",
    tintAlpha: 0.34,
    vignette: ["rgba(255,255,255,0.24)", "rgba(160,70,110,0.55)"],
  },
};

const OUTPUT_FPS = 24;

export class MockRealtimeSession implements RealtimeSession {
  private canvas: HTMLCanvasElement | null = null;
  private outputStream: MediaStream | null = null;
  private rafId: number | null = null;
  private sourceVideo: HTMLVideoElement | null = null;
  private startedAt = 0;
  private closed = false;

  readonly providerSessionId = `demo-session-${Math.random().toString(36).slice(2, 10)}`;

  constructor(
    private readonly grant: ClientSessionGrant,
    private readonly inputStream: MediaStream,
    private readonly videoElement: HTMLVideoElement,
    private readonly theme: ThemeName,
  ) {}

  async connect(): Promise<void> {
    // A short delay so the "Connecting…" state is actually exercised in demos
    // and in E2E tests, rather than being skipped by an instant resolve.
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (this.closed) return;

    const source = document.createElement("video");
    source.autoplay = true;
    source.playsInline = true;
    source.muted = true;
    source.srcObject = this.inputStream;
    await source.play().catch(() => undefined);
    this.sourceVideo = source;

    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth || 720;
    canvas.height = source.videoHeight || 1280;
    this.canvas = canvas;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable.");

    const style = THEMES[this.theme];
    this.startedAt = Date.now();

    const draw = (): void => {
      if (this.closed) return;

      const width = canvas.width;
      const height = canvas.height;

      context.save();
      context.filter = style.filter;
      // Mirror, matching the `mirror: "auto"` the real provider applies.
      context.translate(width, 0);
      context.scale(-1, 1);
      context.drawImage(source, 0, 0, width, height);
      context.restore();

      context.save();
      context.globalAlpha = style.tintAlpha;
      context.fillStyle = style.tint;
      context.fillRect(0, 0, width, height);
      context.restore();

      const gradient = context.createRadialGradient(
        width / 2,
        height * 0.42,
        Math.min(width, height) * 0.12,
        width / 2,
        height * 0.5,
        Math.max(width, height) * 0.72,
      );
      gradient.addColorStop(0, style.vignette[0]);
      gradient.addColorStop(1, style.vignette[1]);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      // Unmistakable watermark: nobody can mistake a demo frame for a real one.
      context.save();
      context.font = `600 ${Math.round(width * 0.035)}px -apple-system, system-ui, sans-serif`;
      context.fillStyle = "rgba(255,255,255,0.72)";
      context.textAlign = "center";
      context.fillText("DEMO MODE — SIMULATED AI", width / 2, height - Math.round(height * 0.035));
      context.restore();

      this.rafId = requestAnimationFrame(draw);
    };
    draw();

    this.outputStream = canvas.captureStream(OUTPUT_FPS);
    this.videoElement.srcObject = this.outputStream;
    await this.videoElement.play().catch(() => undefined);
  }

  async applyExperience(_prompt: string): Promise<void> {
    // The demo session's look is fixed by the theme it was constructed with.
    // Present so the RealtimeSession contract is honoured identically.
  }

  async captureFrame(): Promise<Blob> {
    return captureVideoFrame(this.videoElement);
  }

  billableSeconds(): number {
    if (!this.startedAt) return 0;
    return Math.min(this.grant.maxSessionSeconds, Math.round((Date.now() - this.startedAt) / 1000));
  }

  disconnect(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;

    for (const track of this.inputStream.getTracks()) track.stop();
    if (this.outputStream) {
      for (const track of this.outputStream.getTracks()) track.stop();
    }
    this.outputStream = null;

    if (this.sourceVideo) {
      this.sourceVideo.srcObject = null;
      this.sourceVideo = null;
    }
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.canvas = null;
    }
    this.videoElement.srcObject = null;
  }
}

export function isDemoGrant(grant: ClientSessionGrant): boolean {
  return grant.provider === "mock" || grant.clientToken.startsWith("demo_not_a_real_token_");
}
