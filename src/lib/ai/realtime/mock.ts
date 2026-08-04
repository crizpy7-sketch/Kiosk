"use client";

import type { ClientSessionGrant, RealtimeSession } from "@/lib/ai/provider";
import { captureVideoFrame } from "@/lib/ai/realtime/capture";
import { drawSilhouetteGlow, paintMask, type Frame } from "@/lib/ai/realtime/simulated/scene";
import { STYLES, type ThemeName } from "@/lib/ai/realtime/simulated/styles";
import { loadVision, type VisionFrame, type VisionPipeline } from "@/lib/ai/realtime/simulated/vision";

/**
 * Demo realtime session.
 *
 * Publishes a transformed camera stream via `canvas.captureStream()`, so the
 * reveal, the retake and the capture all exercise the same code paths as
 * production — while no frame leaves the device and no Decart credit is spent.
 *
 * The transformation is real work, not a colour filter: MediaPipe segments the
 * subject from their background on-device, and the style renderers replace the
 * background, trace a halo, and anchor accessories to tracked facial landmarks.
 * The look is deliberately stylised rather than photoreal — this is an
 * impression of what Lucy does, and the watermark says so on every frame.
 *
 * Vision loads in the background. Until it is ready — and permanently, if the
 * device cannot run it — the session renders a plain graded fallback. A demo
 * that quietly degrades beats one that fails in front of a customer.
 */

export type { ThemeName };

/** Fallback treatment, used before vision loads and on devices that can't run it. */
const FALLBACK: Record<ThemeName, { filter: string; tint: string; alpha: number; vignette: [string, string] }> = {
  slime: {
    filter: "saturate(220%) contrast(125%) hue-rotate(290deg)",
    tint: "#ff1e8a",
    alpha: 0.28,
    vignette: ["rgba(180,255,26,0.18)", "rgba(20,0,12,0.85)"],
  },
  anime: {
    filter: "saturate(180%) contrast(140%) brightness(108%) hue-rotate(190deg)",
    tint: "#2e8bff",
    alpha: 0.3,
    vignette: ["rgba(120,200,255,0.2)", "rgba(2,6,18,0.85)"],
  },
  royal: {
    filter: "sepia(55%) saturate(160%) contrast(115%) brightness(104%)",
    tint: "#f2c14e",
    alpha: 0.24,
    vignette: ["rgba(255,220,150,0.16)", "rgba(12,8,2,0.88)"],
  },
  baby: {
    filter: "saturate(150%) brightness(118%) contrast(95%) blur(0.4px)",
    tint: "#ffb3d1",
    alpha: 0.34,
    vignette: ["rgba(255,255,255,0.24)", "rgba(160,70,110,0.55)"],
  },
};

const OUTPUT_FPS = 24;

/**
 * Ceiling on how often the models run, independent of the render rate.
 *
 * Segmentation and landmarking are the only expensive work in the loop, and on
 * a device without a usable GPU they fall back to CPU and will happily consume
 * every frame's budget — starving the main thread badly enough that the whole
 * page stops responding. Twelve analyses a second is well past the point where
 * a halo or a crown looks like it is tracking, and it leaves the UI responsive.
 */
const ANALYSIS_INTERVAL_MS = 80;

/**
 * Model input is downscaled to this width. MediaPipe resizes to its own input
 * size anyway (256×256 and 192×192); handing it a smaller frame just moves that
 * resize off the critical path. The *output* stays at camera resolution, so the
 * photo the customer receives is unaffected.
 */
const ANALYSIS_WIDTH = 384;

export class MockRealtimeSession implements RealtimeSession {
  private canvas: HTMLCanvasElement | null = null;
  private outputStream: MediaStream | null = null;
  private rafId: number | null = null;
  private sourceVideo: HTMLVideoElement | null = null;
  private startedAt = 0;
  private closed = false;

  /** Scratch surfaces, allocated once and reused for the life of the session. */
  private personCanvas: HTMLCanvasElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;

  private analysisCanvas: HTMLCanvasElement | null = null;
  private vision: VisionPipeline | null = null;
  private lastAnalysis: VisionFrame = { personMask: null, face: null };
  private lastAnalysisAt = 0;

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

    this.personCanvas = document.createElement("canvas");
    this.personCanvas.width = canvas.width;
    this.personCanvas.height = canvas.height;
    this.maskCanvas = document.createElement("canvas");

    this.analysisCanvas = document.createElement("canvas");
    this.analysisCanvas.width = ANALYSIS_WIDTH;
    this.analysisCanvas.height = Math.round((ANALYSIS_WIDTH * canvas.height) / canvas.width);

    // Deliberately not awaited: ~16 MB of models must not sit between the
    // customer and their preview. The loop upgrades itself when they arrive.
    void loadVision().then((pipeline) => {
      if (this.closed) pipeline?.close();
      else this.vision = pipeline;
    });

    this.startedAt = Date.now();
    this.renderLoop(context, source);

    this.outputStream = canvas.captureStream(OUTPUT_FPS);
    this.videoElement.srcObject = this.outputStream;
    await this.videoElement.play().catch(() => undefined);
  }

  private renderLoop(ctx: CanvasRenderingContext2D, source: HTMLVideoElement): void {
    const draw = (): void => {
      if (this.closed) return;

      const frame: Frame = {
        width: ctx.canvas.width,
        height: ctx.canvas.height,
        t: (Date.now() - this.startedAt) / 1000,
      };

      const analysis = this.analyze(source, frame);
      if (analysis?.personMask) this.renderStyled(ctx, source, frame, analysis);
      else this.renderFallback(ctx, source, frame);

      this.drawWatermark(ctx, frame);
      this.rafId = requestAnimationFrame(draw);
    };
    draw();
  }

  /** Runs the models at most every ANALYSIS_INTERVAL_MS, on a downscaled frame. */
  private analyze(source: HTMLVideoElement, frame: Frame): VisionFrame | null {
    if (!this.vision) return null;

    const now = performance.now();
    if (now - this.lastAnalysisAt < ANALYSIS_INTERVAL_MS) return this.lastAnalysis;
    this.lastAnalysisAt = now;

    const scaled = this.analysisCanvas;
    const scaledCtx = scaled?.getContext("2d");
    if (!scaled || !scaledCtx) return this.lastAnalysis;

    // Landmarks and masks come back normalised, so they map straight back onto
    // the full-resolution output with no rescaling on our side.
    scaledCtx.drawImage(source, 0, 0, scaled.width, scaled.height);
    this.lastAnalysis = this.vision.analyze(scaled, Math.round(frame.t * 1000));
    return this.lastAnalysis;
  }

  private renderStyled(
    ctx: CanvasRenderingContext2D,
    source: HTMLVideoElement,
    frame: Frame,
    analysis: VisionFrame,
  ): void {
    const style = STYLES[this.theme];
    const personCanvas = this.personCanvas;
    const maskCanvas = this.maskCanvas;
    const personCtx = personCanvas?.getContext("2d");
    if (!personCanvas || !maskCanvas || !personCtx || !analysis.personMask) {
      this.renderFallback(ctx, source, frame);
      return;
    }

    const mask = paintMask(maskCanvas, analysis.personMask);
    if (!mask) {
      this.renderFallback(ctx, source, frame);
      return;
    }

    // Cut the subject out of the camera frame, graded, on a transparent canvas.
    personCtx.setTransform(1, 0, 0, 1, 0, 0);
    personCtx.clearRect(0, 0, frame.width, frame.height);
    personCtx.save();
    personCtx.filter = style.personFilter;
    personCtx.translate(frame.width, 0);
    personCtx.scale(-1, 1);
    personCtx.drawImage(source, 0, 0, frame.width, frame.height);
    personCtx.restore();
    personCtx.save();
    personCtx.globalCompositeOperation = "destination-in";
    // The mask is 256px square upscaled to a 720p frame; without a feather the
    // cutout edge shows every one of those steps as a staircase along the hair.
    personCtx.filter = `blur(${Math.max(1, Math.round(frame.width * 0.004))}px)`;
    // The mask is produced from the unmirrored source, so mirror it to match.
    personCtx.translate(frame.width, 0);
    personCtx.scale(-1, 1);
    personCtx.drawImage(mask, 0, 0, frame.width, frame.height);
    personCtx.restore();

    style.backdrop(ctx, frame);

    // Halo behind the subject, traced from the same silhouette.
    ctx.save();
    ctx.translate(frame.width, 0);
    ctx.scale(-1, 1);
    drawSilhouetteGlow(ctx, mask, frame, style.glow.colour, {
      blur: style.glow.blur,
      spread: style.glow.spread,
      alpha: style.glow.alpha,
    });
    ctx.restore();

    ctx.drawImage(personCanvas, 0, 0);
    style.foreground(ctx, frame, analysis.face);
  }

  /** Colour-grade only: no models, no landmarks, never fails. */
  private renderFallback(ctx: CanvasRenderingContext2D, source: HTMLVideoElement, frame: Frame): void {
    const style = FALLBACK[this.theme];

    ctx.save();
    ctx.filter = style.filter;
    ctx.translate(frame.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, frame.width, frame.height);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = style.alpha;
    ctx.fillStyle = style.tint;
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.restore();

    const gradient = ctx.createRadialGradient(
      frame.width / 2,
      frame.height * 0.42,
      Math.min(frame.width, frame.height) * 0.12,
      frame.width / 2,
      frame.height / 2,
      Math.max(frame.width, frame.height) * 0.72,
    );
    gradient.addColorStop(0, style.vignette[0]);
    gradient.addColorStop(1, style.vignette[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, frame.width, frame.height);
  }

  /** Unmistakable watermark: nobody can mistake a demo frame for a real one. */
  private drawWatermark(ctx: CanvasRenderingContext2D, frame: Frame): void {
    ctx.save();
    ctx.font = `600 ${Math.round(frame.width * 0.035)}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = Math.round(frame.width * 0.012);
    ctx.fillText("DEMO MODE — SIMULATED AI", frame.width / 2, frame.height - Math.round(frame.height * 0.035));
    ctx.restore();
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

    this.vision?.close();
    this.vision = null;

    for (const track of this.inputStream.getTracks()) track.stop();
    if (this.outputStream) {
      for (const track of this.outputStream.getTracks()) track.stop();
    }
    this.outputStream = null;

    if (this.sourceVideo) {
      this.sourceVideo.srcObject = null;
      this.sourceVideo = null;
    }
    for (const canvas of [this.canvas, this.personCanvas, this.maskCanvas, this.analysisCanvas]) {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    this.canvas = null;
    this.personCanvas = null;
    this.maskCanvas = null;
    this.analysisCanvas = null;
    this.videoElement.srcObject = null;
  }
}

export function isDemoGrant(grant: ClientSessionGrant): boolean {
  return grant.provider === "mock" || grant.clientToken.startsWith("demo_not_a_real_token_");
}
