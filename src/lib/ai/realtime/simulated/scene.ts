"use client";

/**
 * Drawing primitives shared by the four simulated styles.
 *
 * Everything here is procedural. No style ships an image asset: a backdrop that
 * is drawn from numbers scales to any camera resolution, animates for free, and
 * adds nothing to the kiosk's download.
 */

import type { FaceGeometry, Point, VisionFrame } from "@/lib/ai/realtime/simulated/vision";

export interface Frame {
  width: number;
  height: number;
  /** Seconds since the session started. Drives every animation. */
  t: number;
}

/** Denormalises a vision point into canvas pixels. */
export function px(point: Point, frame: Frame): { x: number; y: number } {
  return { x: point.x * frame.width, y: point.y * frame.height };
}

/**
 * Renders the person-confidence mask onto a reusable canvas as an alpha
 * channel, so it can be used both as a compositing stencil and as the source
 * of a silhouette glow.
 *
 * The canvas is owned by the caller and reused across frames — allocating a
 * 256×256 canvas 24 times a second is exactly the kind of churn that makes a
 * long-running kiosk stutter.
 */
export function paintMask(
  target: HTMLCanvasElement,
  mask: NonNullable<VisionFrame["personMask"]>,
): HTMLCanvasElement | null {
  if (target.width !== mask.width || target.height !== mask.height) {
    target.width = mask.width;
    target.height = mask.height;
  }
  const ctx = target.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(mask.width, mask.height);
  const out = image.data;
  for (let i = 0, p = 0; i < mask.data.length; i += 1, p += 4) {
    // White pixels with the mask as alpha: usable directly as a stencil.
    out[p] = 255;
    out[p + 1] = 255;
    out[p + 2] = 255;
    out[p + 3] = mask.data[i] ?? 0;
  }
  ctx.putImageData(image, 0, 0);
  return target;
}

/**
 * Scratch surface for the halo. Module-level and reused: one kiosk runs one
 * session at a time, and a full-frame canvas per frame is not free.
 */
let glowCanvas: HTMLCanvasElement | null = null;

/**
 * Draws a soft coloured silhouette of the subject — the halo that sells
 * "something is happening to this person" more than any colour grade does.
 *
 * The blur-and-tint happens on its own surface. Tinting in place would mean a
 * full-frame fill composited against an already-opaque backdrop, which repaints
 * the entire backdrop in the halo colour instead of just the halo — the whole
 * scene collapses to a flat wash and the backdrop may as well not exist.
 */
export function drawSilhouetteGlow(
  ctx: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
  frame: Frame,
  colour: string,
  { blur, spread, alpha }: { blur: number; spread: number; alpha: number },
): void {
  glowCanvas ??= document.createElement("canvas");
  const scratch = glowCanvas;
  if (scratch.width !== frame.width || scratch.height !== frame.height) {
    scratch.width = frame.width;
    scratch.height = frame.height;
  }
  const scratchCtx = scratch.getContext("2d");
  if (!scratchCtx) return;

  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.clearRect(0, 0, frame.width, frame.height);

  const w = frame.width * spread;
  const h = frame.height * spread;
  scratchCtx.save();
  scratchCtx.filter = `blur(${blur}px)`;
  scratchCtx.drawImage(maskCanvas, (frame.width - w) / 2, (frame.height - h) / 2, w, h);
  scratchCtx.restore();

  // Tint only the silhouette: the mask itself is white, and source-in keeps
  // the fill strictly inside the alpha the blur just produced.
  scratchCtx.save();
  scratchCtx.globalCompositeOperation = "source-in";
  scratchCtx.fillStyle = colour;
  scratchCtx.fillRect(0, 0, frame.width, frame.height);
  scratchCtx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/** Deterministic per-particle pseudo-random, so particles don't jitter. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export interface ParticleOptions {
  count: number;
  colour: string;
  /** Frame-heights per second. Negative rises. */
  speed: number;
  minSize: number;
  maxSize: number;
  /** Draws one particle at the origin; defaults to a filled circle. */
  shape?: (ctx: CanvasRenderingContext2D, size: number) => void;
}

/**
 * A drifting particle field. Positions are a pure function of index and time,
 * so there is no per-frame state to keep and nothing to leak.
 */
export function drawParticles(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  { count, colour, speed, minSize, maxSize, shape }: ParticleOptions,
): void {
  ctx.save();
  ctx.fillStyle = colour;
  const scale = Math.min(frame.width, frame.height) / 720;

  for (let i = 0; i < count; i += 1) {
    const seedX = hash(i);
    const seedY = hash(i + 500);
    const seedSize = hash(i + 1000);
    const drift = Math.sin(frame.t * 0.6 + i) * 0.02;

    // Wrap through [0,1) so the field is seamless in both directions.
    const progress = (seedY + frame.t * speed) % 1;
    const y = (progress + 1) % 1;
    const x = (seedX + drift + 1) % 1;
    const size = (minSize + seedSize * (maxSize - minSize)) * scale;

    ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(frame.t * 1.4 + i * 2.3));
    ctx.save();
    ctx.translate(x * frame.width, y * frame.height);
    if (shape) {
      shape(ctx, size);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** A four-pointed sparkle. Reads as "magic" at sizes a circle does not. */
export function sparkle(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.quadraticCurveTo(0, 0, size, 0);
  ctx.quadraticCurveTo(0, 0, 0, size);
  ctx.quadraticCurveTo(0, 0, -size, 0);
  ctx.quadraticCurveTo(0, 0, 0, -size);
  ctx.fill();
}

/** A heart, for Become a Baby. */
export function heart(ctx: CanvasRenderingContext2D, size: number): void {
  const s = size / 10;
  ctx.beginPath();
  ctx.moveTo(0, 4 * s);
  ctx.bezierCurveTo(-10 * s, -4 * s, -4 * s, -10 * s, 0, -4 * s);
  ctx.bezierCurveTo(4 * s, -10 * s, 10 * s, -4 * s, 0, 4 * s);
  ctx.fill();
}

/**
 * Positions the canvas so the origin sits on a face anchor and the axes follow
 * the head's tilt — everything a style draws on the face goes through this, so
 * accessories stay put when the customer moves.
 */
export function withFaceTransform(
  ctx: CanvasRenderingContext2D,
  face: FaceGeometry,
  frame: Frame,
  anchor: Point,
  draw: (ctx: CanvasRenderingContext2D, faceWidthPx: number) => void,
): void {
  const origin = px(anchor, frame);
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(face.roll);
  draw(ctx, face.width * frame.width);
  ctx.restore();
}

/** Vertical linear gradient helper — the backbone of every backdrop. */
export function verticalGradient(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  stops: readonly [number, string][],
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, 0, 0, frame.height);
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  return gradient;
}

/** Soft radial pool of light, used for key lights and bokeh. */
export function radialGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string,
  alpha = 1,
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, colour);
  gradient.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}
