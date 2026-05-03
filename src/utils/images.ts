import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join, extname } from "path";

const IMAGE_EXTENSIONS = new Set([".png", ".bmp", ".jpg", ".jpeg"]);
const PHOTOS_WIDGET_FILENAME = "widget-photos.bmp";
const HASHED_PHOTOS_WIDGET_FILENAME = /^widget-photos--([0-9a-f]{12})\.bmp$/i;
const HASHED_WIDGET_FILENAME = /^(widget-.+)--([0-9a-f]{12})\.bmp$/i;

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
  deviceIndex = 0,
  imageDir?: string
): { image_url: string; filename: string } {
  const sourceFilename =
    images.length > 0 ? images[deviceIndex % images.length] : "default.bmp";
  const filename = buildServedImageFilename(sourceFilename, imageDir);
  const image_url = buildImageUrl(baseUrl, sourceFilename, filename);
  return { image_url, filename };
}

/** Picks an image for a given device (round-robin by device index mod image count). */
export function pickImage(
  imageDir: string,
  baseUrl: string,
  deviceIndex = 0
): { image_url: string; filename: string } {
  return pickImageFromPool(baseUrl, listImages(imageDir), deviceIndex, imageDir);
}

/**
 * For widget BMPs: hash the actual file content so the filename only changes when
 * content changes — the device re-downloads only when there is genuinely new data.
 * For non-widget images: use a timestamp-based token for cache-busting.
 */
function createImageVersionToken(filename: string, imageDir?: string): string {
  if (filename.startsWith("widget-") && filename.endsWith(".bmp") && imageDir) {
    try {
      const content = readFileSync(join(imageDir, filename));
      return createHash("sha1").update(content).digest("hex").slice(0, 12);
    } catch {
      // Fall through to timestamp if file not yet written
    }
  }
  const raw = `${filename}:${Date.now()}:${process.hrtime.bigint().toString()}`;
  return createHash("sha1").update(raw).digest("hex").slice(0, 12);
}

function buildServedImageFilename(filename: string, imageDir?: string): string {
  if (!filename.startsWith("widget-") || !filename.endsWith(".bmp")) return filename;
  return filename.replace(/\.bmp$/i, `--${createImageVersionToken(filename, imageDir)}.bmp`);
}

export function normalizeRequestedImageFilename(filename: string): string {
  if (HASHED_PHOTOS_WIDGET_FILENAME.test(filename)) {
    return PHOTOS_WIDGET_FILENAME;
  }
  const match = HASHED_WIDGET_FILENAME.exec(filename);
  if (match) {
    return `${match[1]}.bmp`;
  }
  return filename;
}

function buildImageUrl(
  baseUrl: string,
  sourceFilename: string,
  servedFilename: string
): string {
  if (sourceFilename.startsWith("widget-") && sourceFilename.endsWith(".bmp")) {
    return new URL(`/images/${servedFilename}`, `${baseUrl}/`).toString();
  }
  const versionToken = createImageVersionToken(sourceFilename);
  return new URL(`/images/${versionToken}/${servedFilename}`, `${baseUrl}/`).toString();
}
