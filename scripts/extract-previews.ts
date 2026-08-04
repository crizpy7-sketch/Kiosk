/**
 * Crops the four style previews out of the supplied brand poster.
 *
 * The poster Cristian provided already contains the four experiences rendered
 * as real portraits — they are the intended look, approved, and photographic.
 * Hand-drawn SVG stand-ins were never going to match them.
 *
 * Uses Chromium's canvas because this environment has no image library and the
 * bundled ffmpeg cannot decode PNG. Crop boxes are fractions of the source, so
 * they survive the poster being re-exported at a different resolution.
 *
 *   npx tsx scripts/extract-previews.ts <poster.png> [outDir]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

/**
 * Fractional crop boxes into the "CHOOSE YOUR AI STYLE" panel of the poster,
 * measured by magnifying the panel and reading off the card edges. Each box is
 * the card's artwork only — the coloured border and the label bar underneath it
 * are excluded, because the kiosk draws its own.
 *
 * `focusY` biases the cover-fit when a near-square source is fitted into a 4:5
 * frame: 0 keeps the top, 0.5 centres. Faces sit high in these compositions, so
 * centring would crop foreheads.
 */
const CROPS: { slug: string; x: number; y: number; w: number; h: number; focusY: number }[] = [
  { slug: "slime-star", x: 0.7061, y: 0.4269, w: 0.1295, h: 0.0555, focusY: 0.42 },
  { slug: "anime-power-up", x: 0.8504, y: 0.4269, w: 0.1295, h: 0.0555, focusY: 0.42 },
  { slug: "royal-fantasy", x: 0.7061, y: 0.5075, w: 0.1295, h: 0.0555, focusY: 0.45 },
  // Narrower on the right: the poster prints a NEW! flash in that corner, and
  // the kiosk draws its own.
  { slug: "become-a-baby", x: 0.8504, y: 0.5075, w: 0.1195, h: 0.0555, focusY: 0.45 },
];

/** 4:5 portrait, matching the card aspect in the kiosk's 2×2 grid. */
const OUT = { width: 720, height: 900 };

async function main(): Promise<void> {
  const posterPath = process.argv[2];
  const outDir = process.argv[3] ?? "public/previews";
  if (!posterPath) throw new Error("Usage: extract-previews.ts <poster.png> [outDir]");

  await mkdir(outDir, { recursive: true });

  const posterDataUri = `data:image/png;base64,${(await readFile(posterPath)).toString("base64")}`;

  const browser = await chromium.launch({
    ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
      ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
      : {}),
  });
  const page = await browser.newPage();

  const results = await page.evaluate(
    async ({ src, crops, out }) => {
      const image = new Image();
      image.src = src;
      await image.decode();

      const written: { slug: string; dataUrl: string; sourceBox: string }[] = [];

      for (const crop of crops) {
        const sx = Math.round(crop.x * image.naturalWidth);
        const sy = Math.round(crop.y * image.naturalHeight);
        const sw = Math.round(crop.w * image.naturalWidth);
        const sh = Math.round(crop.h * image.naturalHeight);

        const canvas = document.createElement("canvas");
        canvas.width = out.width;
        canvas.height = out.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");

        // Cover-fit: fill the 4:5 frame without squashing the portrait.
        const scale = Math.max(out.width / sw, out.height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
          image,
          sx,
          sy,
          sw,
          sh,
          (out.width - dw) / 2,
          (out.height - dh) * crop.focusY,
          dw,
          dh,
        );

        written.push({
          slug: crop.slug,
          // JPEG, not PNG: these are photographs, and PNG made them ~1 MB each —
          // real weight on a kiosk that loads all four at once.
          dataUrl: canvas.toDataURL("image/jpeg", 0.88),
          sourceBox: `${sw}×${sh} at ${sx},${sy}`,
        });
      }

      return { natural: `${image.naturalWidth}×${image.naturalHeight}`, written };
    },
    { src: posterDataUri, crops: CROPS, out: OUT },
  );

  console.log(`Poster: ${results.natural}`);
  for (const item of results.written) {
    const buffer = Buffer.from(item.dataUrl.split(",")[1] ?? "", "base64");
    const path = `${outDir}/${item.slug}.jpg`;
    await writeFile(path, buffer);
    console.log(`  ${item.slug.padEnd(16)} ← ${item.sourceBox.padEnd(20)} → ${Math.round(buffer.byteLength / 1024)} KB`);
  }

  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
