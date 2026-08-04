"use client";

/**
 * The four simulated styles.
 *
 * Each one is a backdrop, a grade for the person layer, and a set of overlays
 * anchored to the face. They are an *impression* of what Lucy produces, drawn
 * with a canvas — deliberately stylised rather than photoreal, because a demo
 * that could be mistaken for the real model is a demo that misleads a customer.
 * The watermark in the compositor makes that explicit; these renderers keep the
 * look on-brand.
 */

import {
  drawParticles,
  heart,
  px,
  radialGlow,
  sparkle,
  verticalGradient,
  withFaceTransform,
  type Frame,
} from "@/lib/ai/realtime/simulated/scene";
import type { FaceGeometry } from "@/lib/ai/realtime/simulated/vision";

export type ThemeName = "slime" | "anime" | "royal" | "baby";

export interface SimulatedStyle {
  /** Canvas filter applied to the person layer only. */
  personFilter: string;
  /** Colour and shape of the halo traced around the subject. */
  glow: { colour: string; blur: number; spread: number; alpha: number };
  /** Drawn first, behind the subject. */
  backdrop(ctx: CanvasRenderingContext2D, frame: Frame): void;
  /** Drawn over the composited subject. `face` is null when none is tracked. */
  foreground(ctx: CanvasRenderingContext2D, frame: Frame, face: FaceGeometry | null): void;
}

/** Where the subject's head sits when no face is tracked — used to aim lighting. */
const DEFAULT_HEAD: { x: number; y: number } = { x: 0.5, y: 0.34 };

function headPoint(frame: Frame, face: FaceGeometry | null): { x: number; y: number } {
  return px(face?.center ?? DEFAULT_HEAD, frame);
}

// ---------------------------------------------------------------- Slime Star

function drawStarGlasses(ctx: CanvasRenderingContext2D, face: FaceGeometry, frame: Frame): void {
  const eyeSpan = Math.hypot(
    (face.eyeLeft.x - face.eyeRight.x) * frame.width,
    (face.eyeLeft.y - face.eyeRight.y) * frame.height,
  );
  // Roughly a lens per eye. Larger than this and the stars swallow the face,
  // which is the opposite of what a portrait product wants.
  const radius = eyeSpan * 0.44;

  const star = (cx: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? radius : radius * 0.42;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  const midX = ((face.eyeLeft.x + face.eyeRight.x) / 2) * frame.width;
  const midY = ((face.eyeLeft.y + face.eyeRight.y) / 2) * frame.height;

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(face.roll);

  ctx.fillStyle = "rgba(12,4,16,0.92)";
  ctx.strokeStyle = "#b4ff1a";
  ctx.lineWidth = Math.max(2, eyeSpan * 0.06);
  ctx.lineJoin = "round";
  star(-eyeSpan / 2);
  star(eyeSpan / 2);

  // Bridge.
  ctx.fillRect(-eyeSpan * 0.16, -eyeSpan * 0.05, eyeSpan * 0.32, eyeSpan * 0.1);

  // Specular highlight, so the lenses read as glossy rather than flat.
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(-eyeSpan * 0.62, -radius * 0.32, radius * 0.22, radius * 0.1, -0.5, 0, Math.PI * 2);
  ctx.ellipse(eyeSpan * 0.38, -radius * 0.32, radius * 0.22, radius * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSlimeDrips(ctx: CanvasRenderingContext2D, face: FaceGeometry, frame: Frame): void {
  withFaceTransform(ctx, face, frame, face.foreheadTop, (c, faceWidth) => {
    // A fringe along the hairline, not a curtain over the frame: the subject's
    // face is the product, and slime that covers it is a worse photo.
    const span = faceWidth * 1.1;
    const top = -faceWidth * 0.34;
    const lip = -faceWidth * 0.12;

    const gradient = c.createLinearGradient(0, top, 0, faceWidth * 0.08);
    gradient.addColorStop(0, "#d9ff4a");
    gradient.addColorStop(0.55, "#8fd400");
    gradient.addColorStop(1, "#4f8a00");

    c.fillStyle = gradient;
    c.beginPath();
    c.moveTo(-span / 2, top);
    c.lineTo(span / 2, top);
    c.lineTo(span / 2, lip);

    // Hanging drips along the underside, each at a fixed depth so they read as
    // one sheet of slime rather than a row of blobs.
    const drips = [0.13, 0.05, 0.19, 0.07, 0.16];
    const step = span / drips.length;
    for (let i = drips.length - 1; i >= 0; i -= 1) {
      const x = -span / 2 + step * i + step / 2;
      const depth = lip + faceWidth * (drips[i] ?? 0.1);
      const wobble = Math.sin(frame.t * 1.6 + i) * faceWidth * 0.012;
      c.quadraticCurveTo(x + step * 0.35, depth + wobble, x, depth + wobble);
      c.quadraticCurveTo(x - step * 0.35, depth + wobble, x - step * 0.5, lip);
    }
    c.lineTo(-span / 2, lip);
    c.closePath();
    c.fill();

    // Gloss run along the top edge.
    c.globalAlpha = 0.5;
    c.fillStyle = "#f4ffd0";
    c.fillRect(-span / 2, top + faceWidth * 0.02, span, faceWidth * 0.025);
  });
}

const SLIME: SimulatedStyle = {
  personFilter: "saturate(190%) contrast(122%) brightness(104%)",
  glow: { colour: "#ff1e8a", blur: 46, spread: 1.06, alpha: 0.85 },

  backdrop(ctx, frame) {
    ctx.fillStyle = verticalGradient(ctx, frame, [
      [0, "#3d0033"],
      [0.55, "#12000f"],
      [1, "#050006"],
    ]);
    ctx.fillRect(0, 0, frame.width, frame.height);

    radialGlow(ctx, frame.width * 0.5, frame.height * 0.22, frame.width * 0.75, "#ff1e8a", 0.5);
    radialGlow(ctx, frame.width * 0.12, frame.height * 0.7, frame.width * 0.5, "#b4ff1a", 0.28);
    radialGlow(ctx, frame.width * 0.9, frame.height * 0.62, frame.width * 0.45, "#b4ff1a", 0.22);

    // Glossy slime blobs drifting behind the subject.
    ctx.save();
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 7; i += 1) {
      const x = ((i * 0.19 + Math.sin(frame.t * 0.35 + i) * 0.05 + 1) % 1) * frame.width;
      const y = ((i * 0.27 + frame.t * 0.035 + 1) % 1) * frame.height;
      const r = frame.width * (0.06 + (i % 3) * 0.03);
      const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, "#b4ff1a");
      blob.addColorStop(1, "transparent");
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  foreground(ctx, frame, face) {
    if (face) {
      drawSlimeDrips(ctx, face, frame);
      drawStarGlasses(ctx, face, frame);
    }
    drawParticles(ctx, frame, {
      count: 34,
      colour: "#eaff9a",
      speed: -0.05,
      minSize: 2,
      maxSize: 6,
      shape: sparkle,
    });
  },
};

// ------------------------------------------------------------ Anime Power-Up

function drawLightning(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  originX: number,
  originY: number,
  seed: number,
): void {
  // One bolt every ~1.2s per seed, visible for a fraction of that — constant
  // lightning reads as noise, intermittent lightning reads as power. Seeds are
  // offset so there is almost always exactly one bolt on screen.
  const phase = (frame.t * 0.85 + seed * 0.37) % 1;
  const window = 0.28;
  if (phase > window) return;

  const angle = seed * 2.4 + Math.floor(frame.t * 0.85 + seed * 0.37) * 1.7;
  const length = frame.height * 0.42;
  const segments = 6;

  ctx.save();
  ctx.globalAlpha = 1 - phase / window;
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "#d8f4ff";
  ctx.shadowColor = "#2e8bff";
  ctx.shadowBlur = 24;
  ctx.lineWidth = Math.max(1.5, frame.width * 0.004);
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(originX, originY);
  for (let i = 1; i <= segments; i += 1) {
    const distance = (length / segments) * i;
    const jitter = Math.sin(seed * 9 + i * 4.1) * frame.width * 0.035;
    ctx.lineTo(
      originX + Math.cos(angle) * distance + jitter,
      originY + Math.sin(angle) * distance + jitter * 0.4,
    );
  }
  ctx.stroke();
  ctx.restore();
}

const ANIME: SimulatedStyle = {
  personFilter: "saturate(155%) contrast(132%) brightness(106%)",
  glow: { colour: "#39a9ff", blur: 52, spread: 1.08, alpha: 1 },

  backdrop(ctx, frame) {
    ctx.fillStyle = verticalGradient(ctx, frame, [
      [0, "#071b3d"],
      [0.5, "#030b1e"],
      [1, "#01040c"],
    ]);
    ctx.fillRect(0, 0, frame.width, frame.height);

    const cx = frame.width * DEFAULT_HEAD.x;
    const cy = frame.height * DEFAULT_HEAD.y;

    // Key light first: drawn after the speed lines it simply erases them.
    radialGlow(ctx, cx, cy, frame.width * 0.62, "#1d5fbf", 0.34);

    // Speed lines radiating from where the head sits: the single most
    // recognisable shorthand for an anime power-up panel.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#7fd4ff";
    for (let i = 0; i < 56; i += 1) {
      const angle = (Math.PI * 2 * i) / 56 + frame.t * 0.08;
      const inner = frame.width * (0.26 + 0.05 * Math.sin(frame.t * 2 + i));
      const outer = frame.width * 1.4;
      ctx.globalAlpha = 0.1 + 0.16 * Math.abs(Math.sin(i * 1.7 + frame.t));
      ctx.lineWidth = frame.width * (0.003 + 0.005 * Math.abs(Math.sin(i * 3.1)));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  },

  foreground(ctx, frame, face) {
    const head = headPoint(frame, face);
    for (let seed = 0; seed < 3; seed += 1) {
      drawLightning(ctx, frame, head.x, head.y + frame.height * 0.06, seed);
    }
    drawParticles(ctx, frame, {
      count: 46,
      colour: "#9fe4ff",
      speed: -0.16,
      minSize: 1.5,
      maxSize: 5,
    });
  },
};

// ----------------------------------------------------------- Royal Fantasy

function drawCrown(ctx: CanvasRenderingContext2D, face: FaceGeometry, frame: Frame): void {
  withFaceTransform(ctx, face, frame, face.foreheadTop, (c, faceWidth) => {
    // Canvas y grows downward, so every crown coordinate is negative: the whole
    // shape sits above the forehead landmark and none of it may reach the eyes.
    const width = faceWidth * 0.86;
    const bandBottom = -faceWidth * 0.1;
    const bandTop = -faceWidth * 0.22;
    const peakTop = -faceWidth * 0.44;
    const centrePeakTop = -faceWidth * 0.52;

    const gold = c.createLinearGradient(0, centrePeakTop, 0, bandBottom);
    gold.addColorStop(0, "#fff2ad");
    gold.addColorStop(0.45, "#e8b542");
    gold.addColorStop(1, "#9a6a12");

    c.save();
    c.shadowColor = "rgba(255,205,110,0.6)";
    c.shadowBlur = faceWidth * 0.12;
    c.fillStyle = gold;

    // Band, then a zigzag of five points rising from its top edge.
    const points = 5;
    const step = width / points;
    c.beginPath();
    c.moveTo(-width / 2, bandBottom);
    c.lineTo(-width / 2, bandTop);
    for (let i = 0; i < points; i += 1) {
      const valleyX = -width / 2 + step * i;
      c.lineTo(valleyX + step / 2, i === 2 ? centrePeakTop : peakTop);
      c.lineTo(valleyX + step, bandTop);
    }
    c.lineTo(width / 2, bandBottom);
    c.closePath();
    c.fill();
    c.restore();

    // Jewels along the band.
    const jewels = ["#c0392b", "#1f6f8b", "#2e7d4f"];
    const jewelY = (bandTop + bandBottom) / 2;
    const jewelR = faceWidth * 0.028;
    for (let i = 0; i < jewels.length; i += 1) {
      const x = (i - 1) * width * 0.26;
      c.fillStyle = jewels[i] ?? "#c0392b";
      c.beginPath();
      c.arc(x, jewelY, jewelR, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.55)";
      c.beginPath();
      c.arc(x - jewelR * 0.35, jewelY - jewelR * 0.35, jewelR * 0.3, 0, Math.PI * 2);
      c.fill();
    }
  });
}

const ROYAL: SimulatedStyle = {
  personFilter: "sepia(30%) saturate(145%) contrast(112%) brightness(103%)",
  glow: { colour: "#ffca6a", blur: 44, spread: 1.05, alpha: 0.8 },

  backdrop(ctx, frame) {
    ctx.fillStyle = verticalGradient(ctx, frame, [
      [0, "#2b1a08"],
      [0.55, "#150c04"],
      [1, "#080401"],
    ]);
    ctx.fillRect(0, 0, frame.width, frame.height);

    // Columns: soft vertical bars that sit behind the subject rather than
    // compete with them. The softness comes from the gradient, not a canvas
    // blur filter — four full-frame blurs per frame is enough on its own to
    // drop the render loop below usable frame rates on a CPU-only device.
    ctx.save();
    for (const at of [0.08, 0.26, 0.74, 0.92]) {
      const w = frame.width * 0.1;
      const column = ctx.createLinearGradient(frame.width * at - w / 2, 0, frame.width * at + w / 2, 0);
      column.addColorStop(0, "rgba(80,55,25,0)");
      column.addColorStop(0.5, "rgba(150,110,55,0.55)");
      column.addColorStop(1, "rgba(80,55,25,0)");
      ctx.fillStyle = column;
      ctx.fillRect(frame.width * at - w / 2, 0, w, frame.height);
    }
    ctx.restore();

    // Candle bokeh.
    for (let i = 0; i < 9; i += 1) {
      const x = frame.width * (0.1 + 0.1 * i);
      const y = frame.height * (0.3 + 0.16 * Math.sin(i * 2.1));
      const flicker = 0.7 + 0.3 * Math.sin(frame.t * 3 + i * 1.9);
      radialGlow(ctx, x, y, frame.width * 0.09, "#ffb347", 0.32 * flicker);
    }

    radialGlow(ctx, frame.width * 0.5, frame.height * 0.2, frame.width * 0.6, "#ffd79a", 0.3);
  },

  foreground(ctx, frame, face) {
    if (face) drawCrown(ctx, face, frame);
    drawParticles(ctx, frame, {
      count: 40,
      colour: "#ffd88a",
      speed: -0.03,
      minSize: 1.5,
      maxSize: 4.5,
    });
  },
};

// ----------------------------------------------------------- Become a Baby

/**
 * Enlarges the eyes by resampling the already-composited frame.
 *
 * This is the one effect that genuinely changes the subject rather than
 * decorating them, and it is what makes the style read as "baby" at all. The
 * patch is clipped to an ellipse and drawn back at a modest scale — enough to
 * be unmistakable, small enough that the seam stays invisible.
 */
/**
 * Scratch surface for the eye patch. Module-level and reused: one kiosk runs
 * one session at a time, and allocating here would mean two canvases a frame.
 */
let eyePatch: HTMLCanvasElement | null = null;

function enlargeEyes(ctx: CanvasRenderingContext2D, face: FaceGeometry, frame: Frame): void {
  const eyeSpan = Math.hypot(
    (face.eyeLeft.x - face.eyeRight.x) * frame.width,
    (face.eyeLeft.y - face.eyeRight.y) * frame.height,
  );
  if (eyeSpan <= 0) return;

  const radiusX = eyeSpan * 0.4;
  const radiusY = eyeSpan * 0.32;
  // Enough to read as "bigger eyes", little enough that the resampled patch
  // still lines up with the face around it.
  const scale = 1.2;

  const patchW = Math.ceil(radiusX * 2);
  const patchH = Math.ceil(radiusY * 2);
  if (patchW < 4 || patchH < 4) return;

  eyePatch ??= document.createElement("canvas");
  const patch = eyePatch;
  if (patch.width !== patchW || patch.height !== patchH) {
    patch.width = patchW;
    patch.height = patchH;
  }
  const patchCtx = patch.getContext("2d");
  if (!patchCtx) return;

  for (const eye of [face.eyeRight, face.eyeLeft]) {
    const { x, y } = px(eye, frame);

    patchCtx.setTransform(1, 0, 0, 1, 0, 0);
    patchCtx.clearRect(0, 0, patchW, patchH);

    // Magnify about the patch centre.
    patchCtx.save();
    patchCtx.translate(patchW / 2, patchH / 2);
    patchCtx.scale(scale, scale);
    patchCtx.drawImage(ctx.canvas, x - patchW / 2, y - patchH / 2, patchW, patchH, -patchW / 2, -patchH / 2, patchW, patchH);
    patchCtx.restore();

    // Feather the patch to nothing at its rim. A hard ellipse edge here is the
    // difference between "bigger eyes" and "two discs stuck on a face".
    const feather = patchCtx.createRadialGradient(
      patchW / 2,
      patchH / 2,
      Math.min(patchW, patchH) * 0.18,
      patchW / 2,
      patchH / 2,
      Math.min(patchW, patchH) * 0.5,
    );
    feather.addColorStop(0, "rgba(0,0,0,1)");
    feather.addColorStop(1, "rgba(0,0,0,0)");
    patchCtx.save();
    patchCtx.globalCompositeOperation = "destination-in";
    patchCtx.fillStyle = feather;
    patchCtx.fillRect(0, 0, patchW, patchH);
    patchCtx.restore();

    ctx.drawImage(patch, x - patchW / 2, y - patchH / 2);

    // A catchlight sells the enlarged eye as an eye rather than a smudge.
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x - radiusX * 0.28, y - radiusY * 0.3, radiusX * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawBow(ctx: CanvasRenderingContext2D, face: FaceGeometry, frame: Frame): void {
  withFaceTransform(ctx, face, frame, face.foreheadTop, (c, faceWidth) => {
    const bandY = -faceWidth * 0.06;

    // Headband, sitting on the hairline rather than arcing over the head.
    c.strokeStyle = "#ff9ec4";
    c.lineWidth = faceWidth * 0.055;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(-faceWidth * 0.46, bandY + faceWidth * 0.05);
    c.quadraticCurveTo(0, bandY - faceWidth * 0.07, faceWidth * 0.46, bandY + faceWidth * 0.05);
    c.stroke();

    // Bow, offset to one side the way a real one sits.
    const bx = faceWidth * 0.24;
    const by = bandY - faceWidth * 0.04;
    const loop = faceWidth * 0.1;

    c.fillStyle = "#ff7fb3";
    for (const direction of [-1, 1]) {
      c.beginPath();
      c.ellipse(bx + direction * loop * 0.95, by, loop, loop * 0.72, direction * 0.35, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#ffb3d1";
    c.beginPath();
    c.arc(bx, by, loop * 0.42, 0, Math.PI * 2);
    c.fill();
  });
}

function drawBlush(ctx: CanvasRenderingContext2D, face: FaceGeometry, frame: Frame): void {
  const width = face.width * frame.width;
  const cheekY = (face.center.y + face.height * 0.22) * frame.height;

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.85;
  ctx.filter = `blur(${Math.max(4, width * 0.06)}px)`;
  ctx.fillStyle = "#ff5f92";
  for (const direction of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      face.center.x * frame.width + direction * width * 0.32,
      cheekY,
      width * 0.17,
      width * 0.12,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

const BABY: SimulatedStyle = {
  // Lifted and softened: the diffused-nursery look, and it also hides the
  // resampling seam left by the eye enlargement.
  personFilter: "saturate(118%) brightness(112%) contrast(93%) blur(0.6px)",
  glow: { colour: "#ffc2dd", blur: 50, spread: 1.07, alpha: 0.9 },

  backdrop(ctx, frame) {
    ctx.fillStyle = verticalGradient(ctx, frame, [
      [0, "#ffd9e8"],
      [0.5, "#ffc0d8"],
      [1, "#f0a5c6"],
    ]);
    ctx.fillRect(0, 0, frame.width, frame.height);

    radialGlow(ctx, frame.width * 0.5, frame.height * 0.28, frame.width * 0.7, "#ffffff", 0.5);

    // Soft pastel orbs, well out of focus.
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 8; i += 1) {
      const x = ((i * 0.23 + Math.sin(frame.t * 0.25 + i) * 0.04 + 1) % 1) * frame.width;
      const y = ((i * 0.31 - frame.t * 0.02 + 1) % 1) * frame.height;
      const r = frame.width * (0.07 + (i % 3) * 0.025);
      const orb = ctx.createRadialGradient(x, y, 0, x, y, r);
      orb.addColorStop(0, "#ffffff");
      orb.addColorStop(1, "transparent");
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  foreground(ctx, frame, face) {
    if (face) {
      enlargeEyes(ctx, face, frame);
      drawBlush(ctx, face, frame);
      drawBow(ctx, face, frame);
    }
    drawParticles(ctx, frame, {
      count: 22,
      colour: "#ff8fbc",
      speed: -0.04,
      minSize: 6,
      maxSize: 14,
      shape: heart,
    });
    drawParticles(ctx, frame, {
      count: 20,
      colour: "#ffffff",
      speed: -0.07,
      minSize: 2,
      maxSize: 5,
      shape: sparkle,
    });
  },
};

export const STYLES: Record<ThemeName, SimulatedStyle> = {
  slime: SLIME,
  anime: ANIME,
  royal: ROYAL,
  baby: BABY,
};
