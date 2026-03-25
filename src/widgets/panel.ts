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

function placeholderSvg(message: string): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>
  <text x="400" y="224"
    text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="46" fill="black">${message}</text>
  <text x="28" y="458"
    font-family="Arial, Helvetica, sans-serif"
    font-size="20" fill="#bbb">xteink</text>
</svg>`;
}

async function svgFallback(message: string): Promise<Buffer> {
  const { data } = await sharp(Buffer.from(placeholderSvg(message)))
    .resize(W, H)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeGrayscaleBmp(data as unknown as Buffer, W, H);
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
