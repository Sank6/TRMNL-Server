/**
 * Shared image-to-1-bit-BMP pipeline.
 *
 * Every widget funnels through one of two entry points:
 *   - svgToBmp(svg)          – high-contrast SVG content (no dithering needed)
 *   - imageToBmp(source, …)  – raster photos/images (Floyd-Steinberg dithered)
 *
 * A third helper, placeholderBmp(), renders a styled error/fallback screen.
 */
import sharp from "sharp";
import { encodeGrayscaleBmp } from "./bmp.js";
import { floydSteinberg } from "./dither.js";

export const DISPLAY_WIDTH = 800;
export const DISPLAY_HEIGHT = 480;

// ── Internals ───────────────────────────────────────────────────────────────

const BAYER_8X8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

function orderedDither(pixels: Buffer, width: number, height: number): Buffer {
  const out = Buffer.alloc(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const threshold = (BAYER_8X8[y % 8]![x % 8]! + 0.5) * 4;
      out[idx] = pixels[idx]! < threshold ? 0 : 255;
    }
  }
  return out;
}

function normalizeToGrayscale(
  pixels: Buffer,
  info: { width: number; height: number; channels: number }
): Buffer {
  const { width, height, channels } = info;

  if (channels === 1) return pixels;

  const out = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    const r = pixels[offset]!;
    const g = channels >= 3 ? pixels[offset + 1]! : r;
    const b = channels >= 3 ? pixels[offset + 2]! : r;
    const alpha =
      channels === 2
        ? pixels[offset + 1]! / 255
        : channels === 4
          ? pixels[offset + 3]! / 255
          : 1;
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    out[i] = Math.round(luma * alpha + 255 * (1 - alpha));
  }
  return out;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render an SVG string to a 1-bit monochrome BMP.
 * No dithering — SVG content is already high-contrast black/white.
 */
export async function svgToBmp(svg: string): Promise<Buffer> {
  const { data } = await sharp(Buffer.from(svg))
    .resize(DISPLAY_WIDTH, DISPLAY_HEIGHT)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeGrayscaleBmp(data as unknown as Buffer, DISPLAY_WIDTH, DISPLAY_HEIGHT);
}

export interface ImageToBmpOptions {
  /** Region the image fills. Defaults to full display (800×480). */
  viewport?: { width: number; height: number };
  /**
   * Full-size SVG (DISPLAY_WIDTH × DISPLAY_HEIGHT) composited on top after
   * the image is placed. Use this for footers/overlays — the SVG is layered
   * over the final 800×480 canvas.
   */
  overlay?: string;
  /** Dithering algorithm. Default: "floyd-steinberg". */
  dither?: "floyd-steinberg" | "ordered" | "none";
}

/**
 * Convert a raster image to a 1-bit dithered BMP.
 *
 * The image is auto-rotated (EXIF), then resized with object-fit: **cover**
 * (scales up/down so the image completely fills the viewport, cropping any
 * overflow from the centre).
 *
 * @param source - Buffer with encoded image data, or an absolute file path.
 * @param options - See {@link ImageToBmpOptions}.
 */
export async function imageToBmp(
  source: Buffer | string,
  options?: ImageToBmpOptions
): Promise<Buffer> {
  const vw = options?.viewport?.width ?? DISPLAY_WIDTH;
  const vh = options?.viewport?.height ?? DISPLAY_HEIGHT;
  const dither = options?.dither ?? "floyd-steinberg";

  // 1. Auto-rotate → cover-fit into the viewport
  let pipeline = sharp(source).rotate().resize(vw, vh, {
    fit: "cover",
    position: "centre",
  });

  // 2. If viewport is smaller than the display, extend to full size for overlay
  if (options?.overlay && (vw !== DISPLAY_WIDTH || vh !== DISPLAY_HEIGHT)) {
    pipeline = pipeline.extend({
      top: 0,
      bottom: DISPLAY_HEIGHT - vh,
      left: 0,
      right: DISPLAY_WIDTH - vw,
      background: { r: 255, g: 255, b: 255 },
    });
  }

  // 3. Composite the overlay SVG (footer, branding, etc.)
  if (options?.overlay) {
    pipeline = pipeline.composite([
      { input: Buffer.from(options.overlay), blend: "over" },
    ]);
  }

  // 4. Convert to grayscale raw pixels
  const { data, info } = await pipeline
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const finalW = options?.overlay ? DISPLAY_WIDTH : vw;
  const finalH = options?.overlay ? DISPLAY_HEIGHT : vh;
  const grayscale = normalizeToGrayscale(data as unknown as Buffer, info);

  // 5. Dither
  let pixels: Buffer;
  if (dither === "floyd-steinberg") {
    pixels = floydSteinberg(grayscale, finalW, finalH);
  } else if (dither === "ordered") {
    pixels = orderedDither(grayscale, finalW, finalH);
  } else {
    pixels = grayscale;
  }

  return encodeGrayscaleBmp(pixels, finalW, finalH);
}

/**
 * Render a styled placeholder/error BMP with a gradient background.
 */
export async function placeholderBmp(message: string): Promise<Buffer> {
  const label = trimText(message, 20);

  const svg = `<svg width="${DISPLAY_WIDTH}" height="${DISPLAY_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1d1d1d"/>
      <stop offset="44%" stop-color="#8f8f8f"/>
      <stop offset="100%" stop-color="#f4f4f4"/>
    </linearGradient>
    <radialGradient id="glow" cx="76%" cy="22%" r="46%">
      <stop offset="0%" stop-color="#fafafa"/>
      <stop offset="55%" stop-color="#cecece"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${DISPLAY_WIDTH}" height="${DISPLAY_HEIGHT}" fill="url(#bg)"/>
  <rect width="${DISPLAY_WIDTH}" height="${DISPLAY_HEIGHT}" fill="url(#glow)"/>
  <path d="M 0 392 C 130 346, 246 366, 336 334 S 564 286, 800 320 L 800 ${DISPLAY_HEIGHT} L 0 ${DISPLAY_HEIGHT} Z"
    fill="#dadada"/>
  <circle cx="624" cy="172" r="88" fill="#f6f6f6"/>
  <rect x="526" y="406" width="230" height="48" fill="white"/>
  <text x="641" y="430"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30" fill="black">${escapeXml(label)}</text>
</svg>`;

  const { data, info } = await sharp(Buffer.from(svg))
    .resize(DISPLAY_WIDTH, DISPLAY_HEIGHT)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grayscale = normalizeToGrayscale(data as unknown as Buffer, info);
  return encodeGrayscaleBmp(
    orderedDither(grayscale, DISPLAY_WIDTH, DISPLAY_HEIGHT),
    DISPLAY_WIDTH,
    DISPLAY_HEIGHT
  );
}
