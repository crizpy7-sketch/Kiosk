/**
 * Builds a y4m clip for Chromium's fake camera from a still image.
 *
 * Chrome's built-in fake capture device is a rolling colour pattern with no
 * person in it, so it cannot exercise the demo provider's segmentation or face
 * tracking at all — every run silently falls back to the colour grade. Feeding
 * `--use-file-for-fake-video-capture` a real portrait is the only way to see
 * whether the pipeline actually works.
 *
 * Chromium does the decoding (this environment has no image library, and the
 * bundled ffmpeg is a webm muxer with no still-image decoders); Node does the
 * RGB→I420 conversion.
 *
 *   npx tsx scripts/make-fake-camera.ts <image> <out.y4m> [x y w h]
 *
 * The optional crop is given as fractions of the source, so it survives the
 * source being re-exported at another resolution.
 */
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { chromium } from "@playwright/test";

/** Portrait, matching the kiosk's camera aspect. */
const OUT = { width: 720, height: 1280 };
/** Frames written. Chromium loops the file, so a still only needs one. */
const FRAMES = 1;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function decodeToRgba(
  imagePath: string,
  crop: { x: number; y: number; w: number; h: number },
): Promise<{ rgba: Uint8Array; natural: string }> {
  const mime = MIME[extname(imagePath).toLowerCase()] ?? "image/png";
  const dataUri = `data:${mime};base64,${(await readFile(imagePath)).toString("base64")}`;

  const browser = await chromium.launch({
    ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
      ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
      : {}),
  });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(
      async ({ src, box, out }) => {
        const image = new Image();
        image.src = src;
        await image.decode();

        const sx = Math.round(box.x * image.naturalWidth);
        const sy = Math.round(box.y * image.naturalHeight);
        const sw = Math.round(box.w * image.naturalWidth);
        const sh = Math.round(box.h * image.naturalHeight);

        const canvas = document.createElement("canvas");
        canvas.width = out.width;
        canvas.height = out.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");

        // Cover-fit so the portrait fills the frame without distortion.
        const scale = Math.max(out.width / sw, out.height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, sx, sy, sw, sh, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);

        const pixels = ctx.getImageData(0, 0, out.width, out.height).data;
        return {
          rgba: Array.from(pixels),
          natural: `${image.naturalWidth}×${image.naturalHeight}`,
        };
      },
      { src: dataUri, box: crop, out: OUT },
    );
    return { rgba: Uint8Array.from(result.rgba), natural: result.natural };
  } finally {
    await browser.close();
  }
}

/** BT.601, the colour space y4m's C420 tag implies. */
function rgbaToI420(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const cSize = (width / 2) * (height / 2);
  const out = new Uint8Array(ySize + cSize * 2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const r = rgba[p] ?? 0;
      const g = rgba[p + 1] ?? 0;
      const b = rgba[p + 2] ?? 0;
      out[y * width + x] = Math.max(0, Math.min(255, 0.299 * r + 0.587 * g + 0.114 * b));
    }
  }

  // Chroma planes are half resolution: average each 2×2 block.
  for (let y = 0; y < height / 2; y += 1) {
    for (let x = 0; x < width / 2; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dy, dx] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ] as const) {
        const p = ((y * 2 + dy) * width + (x * 2 + dx)) * 4;
        r += rgba[p] ?? 0;
        g += rgba[p + 1] ?? 0;
        b += rgba[p + 2] ?? 0;
      }
      r /= 4;
      g /= 4;
      b /= 4;
      const index = y * (width / 2) + x;
      out[ySize + index] = Math.max(0, Math.min(255, -0.169 * r - 0.331 * g + 0.5 * b + 128));
      out[ySize + cSize + index] = Math.max(0, Math.min(255, 0.5 * r - 0.419 * g - 0.081 * b + 128));
    }
  }

  return out;
}

async function main(): Promise<void> {
  const [imagePath, outPath, ...box] = process.argv.slice(2);
  if (!imagePath || !outPath) {
    throw new Error("Usage: make-fake-camera.ts <image> <out.y4m> [x y w h]");
  }

  const crop =
    box.length === 4
      ? { x: Number(box[0]), y: Number(box[1]), w: Number(box[2]), h: Number(box[3]) }
      : { x: 0, y: 0, w: 1, h: 1 };

  const { rgba, natural } = await decodeToRgba(imagePath, crop);
  const plane = rgbaToI420(rgba, OUT.width, OUT.height);

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [
    encoder.encode(`YUV4MPEG2 W${OUT.width} H${OUT.height} F24:1 Ip A1:1 C420jpeg\n`),
  ];
  for (let i = 0; i < FRAMES; i += 1) {
    chunks.push(encoder.encode("FRAME\n"), plane);
  }

  const file = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.byteLength;
  }

  await writeFile(outPath, file);
  console.log(
    `${imagePath} (${natural}) → ${outPath}: ${OUT.width}×${OUT.height}, ` +
      `${FRAMES} frame(s), ${Math.round(file.byteLength / 1024)} KB`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
