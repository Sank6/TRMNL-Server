/**
 * Panel widget — renders a local image file onto the 1-bit display using
 * Floyd-Steinberg dithering. Configure the image path with PANEL_IMAGE_PATH.
 */
import sharp from "sharp";
import { encodeGrayscaleBmp } from "./bmp.js";
import { floydSteinberg } from "./dither.js";
import type { WidgetDefinition } from "./types.js";

const W = 800;
const H = 480;
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

function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function orderedDither(pixels: Buffer, width: number, height: number): Buffer {
  const out = Buffer.alloc(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const threshold = (BAYER_8X8[y % 8]![x % 8]! + 0.5) * 4;
      out[idx] = pixels[idx] < threshold ? 0 : 255;
    }
  }
  return out;
}

function placeholderSvg(message: string): string {
  const label = trimText(message.includes("PANEL_IMAGE_PATH") ? "Missing Config" : message, 20);
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
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
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <path d="M 0 392 C 130 346, 246 366, 336 334 S 564 286, 800 320 L 800 ${H} L 0 ${H} Z"
    fill="#dadada"/>
  <circle cx="624" cy="172" r="88" fill="#f6f6f6"/>
  <rect x="526" y="406" width="230" height="48" fill="white"/>
  <text x="641" y="430"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30" fill="black">${escapeXml(label)}</text>
</svg>`;
}

async function svgFallback(message: string): Promise<Buffer> {
  const { data } = await sharp(Buffer.from(placeholderSvg(message)))
    .resize(W, H)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeGrayscaleBmp(orderedDither(data as unknown as Buffer, W, H), W, H);
}

export async function renderPanelBmp(): Promise<Buffer> {
  const imagePath = process.env.PANEL_IMAGE_PATH;

  if (!imagePath) return svgFallback("Set PANEL_IMAGE_PATH to display an image");

  try {
    const { data } = await sharp(imagePath)
      .resize(W, H, { fit: "cover", position: "centre" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const dithered = floydSteinberg(data as unknown as Buffer, W, H);
    return encodeGrayscaleBmp(dithered, W, H);
  } catch {
    return svgFallback("Image load failed");
  }
}

export const panelWidget: WidgetDefinition = {
  name: "panel",
  render: () => renderPanelBmp(),
  envVars: [
    {
      name: "PANEL_IMAGE_PATH",
      description: "Absolute path to an image file to display (JPEG, PNG, HEIC, …)",
      required: false,
    },
  ],
};
