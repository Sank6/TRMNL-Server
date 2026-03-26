/**
 * Panel widget — renders a local image file onto the 1-bit display using
 * Floyd-Steinberg dithering. Configure the image path with PANEL_IMAGE_PATH.
 */
import { imageToBmp, placeholderBmp } from "./image-pipeline.js";
import type { WidgetDefinition } from "./types.js";

export async function renderPanelBmp(): Promise<Buffer> {
  const imagePath = process.env.PANEL_IMAGE_PATH;

  if (!imagePath) return placeholderBmp("Set PANEL_IMAGE_PATH");

  try {
    return await imageToBmp(imagePath);
  } catch {
    return placeholderBmp("Image load failed");
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
