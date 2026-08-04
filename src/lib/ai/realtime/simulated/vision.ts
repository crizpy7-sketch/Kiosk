"use client";

/**
 * On-device vision for the simulated provider.
 *
 * Demo mode has no AI model behind it, so the only way for the demo to look
 * like the product is to actually understand the frame: where the person ends
 * and the background begins, and where the face sits. MediaPipe gives us both,
 * on-device, with no account and no frame ever leaving the iPad.
 *
 * Everything here is best-effort. If the models fail to load — old Safari, no
 * WASM SIMD, a corrupted asset — `load()` returns null and the caller falls
 * back to a plain colour grade. A demo that degrades is better than a kiosk
 * that throws in front of a customer.
 */

import type { FaceLandmarker, ImageSegmenter, NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Served from /public. Vendored, not CDN-loaded: the CSP forbids other hosts. */
const WASM_PATH = "/vision";
const SEGMENTER_MODEL = "/models/selfie_segmenter.tflite";
const LANDMARKER_MODEL = "/models/face_landmarker.task";

/** Landmark indices into MediaPipe's 478-point face mesh. */
const LM = {
  foreheadTop: 10,
  chin: 152,
  cheekRight: 234,
  cheekLeft: 454,
  eyeRightOuter: 33,
  eyeRightInner: 133,
  eyeLeftInner: 362,
  eyeLeftOuter: 263,
  irisRight: 468,
  irisLeft: 473,
  noseTip: 1,
  mouthTop: 13,
  mouthBottom: 14,
} as const;

export interface Point {
  /** Normalised to the frame, 0–1, already mirrored to match the display. */
  x: number;
  y: number;
}

/**
 * Face geometry in normalised frame coordinates, reduced to the handful of
 * anchors the style renderers actually need. The full 478-point mesh is
 * deliberately not exposed: nothing downstream should be able to build a face
 * signature out of it.
 */
export interface FaceGeometry {
  /** Centre of the face box. */
  center: Point;
  /** Cheek-to-cheek width and forehead-to-chin height, normalised. */
  width: number;
  height: number;
  /** Head tilt in radians, from the eye line. */
  roll: number;
  foreheadTop: Point;
  chin: Point;
  eyeRight: Point;
  eyeLeft: Point;
  mouth: Point;
  /** Vertical mouth opening as a fraction of face height. */
  mouthOpen: number;
}

export interface VisionFrame {
  /**
   * Per-pixel person confidence, 0–255, at the segmenter's native resolution.
   * Null when segmentation is unavailable for this frame.
   */
  personMask: { data: Uint8ClampedArray; width: number; height: number } | null;
  face: FaceGeometry | null;
}

export interface VisionPipeline {
  /**
   * Analyses one frame. Never throws; returns empty results on failure.
   *
   * Accepts a canvas as well as a video so callers can hand the models a
   * downscaled copy — results are normalised either way.
   */
  analyze(source: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): VisionFrame;
  close(): void;
}

function mirrored(landmark: NormalizedLandmark): Point {
  // The kiosk mirrors the camera so the customer sees themselves as in a
  // mirror. Landmarks arrive in source space, so mirror them once here rather
  // than in every style renderer.
  return { x: 1 - landmark.x, y: landmark.y };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toGeometry(landmarks: readonly NormalizedLandmark[]): FaceGeometry | null {
  const at = (index: number): Point | null => {
    const landmark = landmarks[index];
    return landmark ? mirrored(landmark) : null;
  };

  const foreheadTop = at(LM.foreheadTop);
  const chin = at(LM.chin);
  const cheekA = at(LM.cheekRight);
  const cheekB = at(LM.cheekLeft);
  const eyeRightOuter = at(LM.eyeRightOuter);
  const eyeRightInner = at(LM.eyeRightInner);
  const eyeLeftInner = at(LM.eyeLeftInner);
  const eyeLeftOuter = at(LM.eyeLeftOuter);
  const mouthTop = at(LM.mouthTop);
  const mouthBottom = at(LM.mouthBottom);

  if (
    !foreheadTop ||
    !chin ||
    !cheekA ||
    !cheekB ||
    !eyeRightOuter ||
    !eyeRightInner ||
    !eyeLeftInner ||
    !eyeLeftOuter ||
    !mouthTop ||
    !mouthBottom
  ) {
    return null;
  }

  // Prefer the iris centres when the model resolved them; they are far steadier
  // than the eyelid corners, which jitter as the subject blinks.
  const irisRight = at(LM.irisRight);
  const irisLeft = at(LM.irisLeft);
  const eyeRight = irisRight ?? {
    x: (eyeRightOuter.x + eyeRightInner.x) / 2,
    y: (eyeRightOuter.y + eyeRightInner.y) / 2,
  };
  const eyeLeft = irisLeft ?? {
    x: (eyeLeftOuter.x + eyeLeftInner.x) / 2,
    y: (eyeLeftOuter.y + eyeLeftInner.y) / 2,
  };

  const height = distance(foreheadTop, chin);
  if (height <= 0) return null;

  // Order the eyes left-to-right *on screen* before measuring the tilt.
  // Mirroring swaps which anatomical eye has the smaller x, so taking the
  // subject's left minus their right yields an angle near π for an upright
  // head — which silently draws every face-anchored accessory upside down.
  const [screenLeftEye, screenRightEye] =
    eyeRight.x <= eyeLeft.x ? [eyeRight, eyeLeft] : [eyeLeft, eyeRight];

  return {
    center: { x: (foreheadTop.x + chin.x) / 2, y: (foreheadTop.y + chin.y) / 2 },
    width: distance(cheekA, cheekB),
    height,
    roll: Math.atan2(screenRightEye.y - screenLeftEye.y, screenRightEye.x - screenLeftEye.x),
    foreheadTop,
    chin,
    eyeRight,
    eyeLeft,
    mouth: { x: (mouthTop.x + mouthBottom.x) / 2, y: (mouthTop.y + mouthBottom.y) / 2 },
    mouthOpen: distance(mouthTop, mouthBottom) / height,
  };
}

/**
 * Loads both models. Resolves to null — never rejects — when the environment
 * cannot run them, so callers can treat "no vision" as an ordinary state.
 */
export async function loadVision(): Promise<VisionPipeline | null> {
  let segmenter: ImageSegmenter | null = null;
  let landmarker: FaceLandmarker | null = null;

  try {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);

    [segmenter, landmarker] = await Promise.all([
      vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      }),
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: LANDMARKER_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      }),
    ]);
  } catch {
    segmenter?.close();
    landmarker?.close();
    return null;
  }

  const activeSegmenter = segmenter;
  const activeLandmarker = landmarker;
  let closed = false;
  // MediaPipe's VIDEO mode rejects a timestamp that does not advance, which a
  // paused tab or a duplicated frame can easily produce.
  let lastTimestamp = -1;

  return {
    analyze(source, timestampMs) {
      const empty: VisionFrame = { personMask: null, face: null };
      if (closed) return empty;

      const timestamp = timestampMs <= lastTimestamp ? lastTimestamp + 1 : timestampMs;
      lastTimestamp = timestamp;

      let personMask: VisionFrame["personMask"] = null;
      let face: FaceGeometry | null = null;

      try {
        const result = activeSegmenter.segmentForVideo(source, timestamp);
        const masks = result.confidenceMasks;
        // Two categories (background, person) when the model reports both;
        // a single mask is already the person channel.
        const chosen = masks && masks.length > 0 ? masks[masks.length - 1] : undefined;
        if (chosen) {
          const values = chosen.getAsFloat32Array();
          const data = new Uint8ClampedArray(values.length);
          for (let i = 0; i < values.length; i += 1) data[i] = (values[i] ?? 0) * 255;
          personMask = { data, width: chosen.width, height: chosen.height };
        }
        result.close();
      } catch {
        personMask = null;
      }

      try {
        const result = activeLandmarker.detectForVideo(source, timestamp);
        const first = result.faceLandmarks[0];
        if (first && first.length > 0) face = toGeometry(first);
      } catch {
        face = null;
      }

      return { personMask, face };
    },

    close() {
      if (closed) return;
      closed = true;
      activeSegmenter.close();
      activeLandmarker.close();
    },
  };
}
