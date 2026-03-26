import { readdirSync } from "fs";
import { join, extname } from "path";

const IMAGE_EXTENSIONS = new Set([".png", ".bmp", ".jpg", ".jpeg"]);

/** Returns all image filenames in the given directory, sorted alphabetically. */
export function listImages(imageDir: string): string[] {
  try {
    return readdirSync(imageDir)
      .filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

export function listWidgetImages(imageDir: string): string[] {
  return listImages(imageDir).filter(
    (filename) => filename.startsWith("widget-") && filename.endsWith(".bmp")
  );
}

export function listNonWidgetImages(imageDir: string): string[] {
  return listImages(imageDir).filter((filename) => !filename.startsWith("widget-"));
}

export function pickImageFromPool(
  baseUrl: string,
  images: string[],
  deviceIndex = 0
): { image_url: string; filename: string } {
  const filename = images.length > 0 ? images[deviceIndex % images.length] : "default.bmp";
  const image_url = `${baseUrl}/images/${filename}`;
  return { image_url, filename };
}

/** Picks an image for a given device (round-robin by device index mod image count). */
export function pickImage(
  imageDir: string,
  baseUrl: string,
  deviceIndex = 0
): { image_url: string; filename: string } {
  return pickImageFromPool(baseUrl, listImages(imageDir), deviceIndex);
}
