import sharp from "sharp";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Config } from "../config.js";
import { encodeGrayscaleBmp } from "./bmp.js";
import { floydSteinberg } from "./dither.js";
import type { WidgetDefinition } from "./types.js";

const W = 800;
const H = 480;
const FOOTER_H = 56;
const PHOTO_H = H - FOOTER_H;
const MIN_DISPLAY_EDGE = Math.min(W, PHOTO_H);
const MAX_DISPLAY_EDGE = Math.max(W, PHOTO_H);
export const PHOTOS_ORIGINAL_CACHE_FILENAME = "widget-photos-original.bin";
export const PHOTOS_FITTED_PREVIEW_FILENAME = "widget-photos-fitted-preview.png";
const ICLOUD_SHARED_STREAMS_HOST = "sharedstreams.icloud.com";
const REQUEST_TIMEOUT_MS = 15_000;
const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_DELAY_MS = 500;
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

interface SharedStreamDerivative {
  checksum?: string;
  fileSize?: string;
  width?: string;
  height?: string;
}

interface SharedStreamPhoto {
  photoGuid: string;
  caption?: string;
  dateCreated?: string;
  batchDateCreated?: string;
  width?: string;
  height?: string;
  derivatives?: Record<string, SharedStreamDerivative>;
}

interface SharedStreamResponse {
  streamName?: string;
  streamCtag?: string | null;
  photos?: SharedStreamPhoto[];
}

interface SharedAssetLocation {
  scheme?: string;
  hosts?: string[];
}

interface SharedAssetUrl {
  url_location?: string;
  url_path?: string;
  url_expiry?: string;
}

interface SharedAssetUrlsResponse {
  locations?: Record<string, SharedAssetLocation>;
  items?: Record<string, SharedAssetUrl>;
}

interface SelectedPhoto {
  albumName: string;
  caption: string;
  createdAt: string;
  photoGuid: string;
  checksum: string;
}

interface ResolvedPhoto {
  imageUrl: string;
  label: string;
  dateLabel: string;
}

interface PhotoImagePayload {
  image: Buffer;
  label: string;
  dateLabel: string;
}

interface ResizePlan {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface RawImageInfo {
  width: number;
  height: number;
  channels: number;
}

function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function resolveSharedAlbumToken(urlOrToken?: string): string | null {
  if (!urlOrToken) return null;

  const raw = urlOrToken.trim();
  if (!raw) return null;

  if (!raw.includes("://")) {
    return raw.replace(/^#/, "") || null;
  }

  try {
    const url = new URL(raw);
    const hashToken = url.hash.replace(/^#/, "").trim();
    if (hashToken) return hashToken;

    const pathParts = url.pathname.split("/").filter(Boolean);
    return pathParts.at(-1) ?? null;
  } catch {
    return null;
  }
}

export function selectPhotoFromStream(
  stream: SharedStreamResponse,
  preferredIndex = 0
): SelectedPhoto {
  const photos = [...(stream.photos ?? [])].filter((photo) => {
    return Boolean(photo.photoGuid && pickLargestDerivativeChecksum(photo));
  });

  if (photos.length === 0) {
    throw new Error("Apple Photos album is empty or contains no downloadable photos");
  }

  photos.sort((a, b) => newestTimestamp(b) - newestTimestamp(a));

  const safeIndex = Math.max(0, Math.min(preferredIndex, photos.length - 1));
  const selected = photos[safeIndex]!;
  const checksum = pickLargestDerivativeChecksum(selected);
  if (!checksum) {
    throw new Error(`No downloadable derivative found for photo ${selected.photoGuid}`);
  }

  return {
    albumName: stream.streamName?.trim() || "Apple Photos",
    caption: selected.caption?.trim() || "",
    createdAt: selected.dateCreated || selected.batchDateCreated || "",
    photoGuid: selected.photoGuid,
    checksum,
  };
}

function newestTimestamp(photo: SharedStreamPhoto): number {
  const candidate = photo.dateCreated || photo.batchDateCreated;
  const parsed = candidate ? Date.parse(candidate) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickLargestDerivativeChecksum(photo: SharedStreamPhoto): string | null {
  const derivatives = Object.values(photo.derivatives ?? {});
  if (derivatives.length === 0) return null;

  const withChecksums = derivatives.filter((d) => Boolean(d.checksum));
  const selected = withChecksums
    .filter(isDisplaySizedDerivative)
    .sort(compareDerivativeSizeAscending)[0]
    ?? withChecksums.sort(compareDerivativeSizeDescending)[0];

  return selected?.checksum ?? null;
}

function isDisplaySizedDerivative(derivative: SharedStreamDerivative): boolean {
  const width = parseInt(derivative.width ?? "", 10);
  const height = parseInt(derivative.height ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;

  const shorterEdge = Math.min(width, height);
  const longerEdge = Math.max(width, height);
  return shorterEdge >= MIN_DISPLAY_EDGE && longerEdge >= MAX_DISPLAY_EDGE;
}

function compareDerivativeSizeAscending(
  a: SharedStreamDerivative,
  b: SharedStreamDerivative
): number {
  return compareDerivativeMetric(a, b);
}

function compareDerivativeSizeDescending(
  a: SharedStreamDerivative,
  b: SharedStreamDerivative
): number {
  return compareDerivativeMetric(b, a);
}

function compareDerivativeMetric(
  a: SharedStreamDerivative,
  b: SharedStreamDerivative
): number {
  const areaDelta = derivativeArea(a) - derivativeArea(b);
  if (areaDelta !== 0) return areaDelta;
  return derivativeFileSize(a) - derivativeFileSize(b);
}

function derivativeArea(derivative: SharedStreamDerivative): number {
  const width = parseInt(derivative.width ?? "", 10);
  const height = parseInt(derivative.height ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return Number.POSITIVE_INFINITY;
  return width * height;
}

function derivativeFileSize(derivative: SharedStreamDerivative): number {
  const fileSize = parseInt(derivative.fileSize ?? "", 10);
  return Number.isFinite(fileSize) ? fileSize : Number.POSITIVE_INFINITY;
}

function formatPhotoDate(isoDate: string): string {
  if (!isoDate) return "Unknown date";

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function buildFooterSvg(albumName: string, caption: string, dateLabel: string): string {
  const leftLabel = trimText(caption || albumName, 38);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${PHOTO_H}" width="${W}" height="${FOOTER_H}" fill="white"/>
  <text x="44" y="459"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28" fill="black">${escapeXml(leftLabel)}</text>
  <text x="${W - 44}" y="459"
    text-anchor="end"
    font-family="Arial, Helvetica, sans-serif"
    font-size="28" fill="black">${escapeXml(dateLabel)}</text>
</svg>`;
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

export function planContainedPhotoResize(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): ResizePlan {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Photo dimensions must be positive");
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight, 1);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const horizontalPadding = targetWidth - width;
  const verticalPadding = targetHeight - height;

  return {
    width,
    height,
    left: Math.floor(horizontalPadding / 2),
    right: Math.ceil(horizontalPadding / 2),
    top: Math.floor(verticalPadding / 2),
    bottom: Math.ceil(verticalPadding / 2),
  };
}

export function normalizeRawGrayscalePixels(
  pixels: Buffer,
  info: RawImageInfo
): Buffer {
  const { width, height, channels } = info;
  const expectedLength = width * height * channels;

  if (channels < 1 || channels > 4) {
    throw new Error(`Unsupported raw image channel count: ${channels}`);
  }

  if (pixels.length !== expectedLength) {
    throw new Error(
      `Raw image buffer length mismatch: expected ${expectedLength} bytes, got ${pixels.length}`
    );
  }

  if (channels === 1) {
    return pixels;
  }

  const out = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    const r = pixels[offset]!;
    const g = channels >= 3 ? pixels[offset + 1]! : r;
    const b = channels >= 3 ? pixels[offset + 2]! : r;
    const alpha = channels === 2
      ? pixels[offset + 1]! / 255
      : channels === 4
        ? pixels[offset + 3]! / 255
        : 1;
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    out[i] = Math.round((luma * alpha) + (255 * (1 - alpha)));
  }

  return out;
}

async function fitPhotoWithinViewport(image: Buffer): Promise<Buffer> {
  const normalized = sharp(image).rotate();
  const metadata = await normalized.metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  const plan = planContainedPhotoResize(sourceWidth, sourceHeight, W, PHOTO_H);

  return normalized
    .resize(plan.width, plan.height, {
      fit: "fill",
      withoutEnlargement: true,
    })
    .extend({
      left: plan.left,
      right: plan.right,
      top: plan.top,
      bottom: plan.bottom,
      background: { r: 255, g: 255, b: 255 },
    })
    .grayscale()
    .toBuffer();
}

async function placeholderBmp(message: string): Promise<Buffer> {
  const label = trimText(
    message.includes("PHOTOS_SHARED_ALBUM") ? "Missing Config" : message,
    20
  );

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
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

  const { data, info } = await sharp(Buffer.from(svg))
    .resize(W, H)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grayscale = normalizeRawGrayscalePixels(data as unknown as Buffer, info);
  return encodeGrayscaleBmp(orderedDither(grayscale, W, H), W, H);
}

function describeFetchError(prefix: string, url: string, error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return new Error(`${prefix}: timed out after ${REQUEST_TIMEOUT_MS}ms (${url})`);
    }

    const cause = (error as Error & { cause?: unknown }).cause;
    const causeMessage =
      cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
        ? cause.message
        : null;

    return new Error(`${prefix}: ${causeMessage || error.message} (${url})`);
  }

  return new Error(`${prefix}: unknown error (${url})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldRetryAppleFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "TimeoutError") {
    return true;
  }

  const candidateMessages = [error.message];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
    candidateMessages.push(cause.message);
  }

  return candidateMessages.some((message) => {
    return /ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|socket hang up|fetch failed/i.test(message);
  });
}

async function fetchWithRetries(
  url: string,
  init: RequestInit,
  errorPrefix: string
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_RETRY_ATTEMPTS || !shouldRetryAppleFetchError(error)) {
        throw describeFetchError(errorPrefix, url, error);
      }
      await sleep(FETCH_RETRY_DELAY_MS * attempt);
    }
  }

  throw describeFetchError(errorPrefix, url, lastError);
}

async function postJson(url: string, payload: unknown): Promise<Response> {
  return await fetchWithRetries(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "xteink-server/1.0",
    },
    body: JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, "Apple Photos API request failed");
}

async function resolvePhoto(token: string): Promise<ResolvedPhoto> {
  let baseUrl = `https://${ICLOUD_SHARED_STREAMS_HOST}/${token}/sharedstreams`;
  let response = await postJson(`${baseUrl}/webstream`, { streamCtag: null });

  if (response.status === 330) {
    const redirectHost = response.headers.get("x-apple-mme-host");
    if (!redirectHost) {
      throw new Error("Apple Photos API redirect did not provide an iCloud host");
    }

    baseUrl = `https://${redirectHost}/${token}/sharedstreams`;
    response = await postJson(`${baseUrl}/webstream`, { streamCtag: null });
  }

  if (!response.ok) {
    throw new Error(`Apple Photos webstream failed with HTTP ${response.status}`);
  }

  const stream = await response.json() as SharedStreamResponse;
  const selected = selectPhotoFromStream(stream, readPhotoIndex());
  const assetUrls = await fetchAssetUrls(baseUrl, selected.photoGuid);
  return {
    imageUrl: buildAssetUrl(assetUrls, selected.checksum),
    label: selected.caption || selected.albumName,
    dateLabel: formatPhotoDate(selected.createdAt),
  };
}

async function fetchAssetUrls(baseUrl: string, photoGuid: string): Promise<SharedAssetUrlsResponse> {
  const response = await postJson(`${baseUrl}/webasseturls`, { photoGuids: [photoGuid] });
  if (!response.ok) {
    throw new Error(`Apple Photos webasseturls failed with HTTP ${response.status}`);
  }

  return await response.json() as SharedAssetUrlsResponse;
}

export function buildAssetUrl(payload: SharedAssetUrlsResponse, checksum: string): string {
  const asset = payload.items?.[checksum];
  if (!asset?.url_path) {
    throw new Error("Apple Photos asset response did not include the requested image");
  }

  const locationKey = asset.url_location ?? "";
  const location = payload.locations?.[locationKey];
  const scheme = location?.scheme ?? "https";
  const host = location?.hosts?.[0] ?? locationKey;

  if (!host) {
    throw new Error("Apple Photos asset response did not include a host");
  }

  return `${scheme}://${host}${asset.url_path}`;
}

function readPhotoIndex(): number {
  const raw = process.env.PHOTOS_INDEX;
  if (!raw) return 0;

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function fetchPhotoImage(): Promise<PhotoImagePayload> {
  const token = resolveSharedAlbumToken(
    process.env.PHOTOS_SHARED_ALBUM_URL ?? process.env.PHOTOS_SHARED_ALBUM_TOKEN
  );

  if (!token) {
    throw new Error("Set PHOTOS_SHARED_ALBUM_URL or PHOTOS_SHARED_ALBUM_TOKEN");
  }

  const photo = await resolvePhoto(token);

  let imageResponse: Response;
  try {
    imageResponse = await fetchWithRetries(photo.imageUrl, {
      headers: { "user-agent": "xteink-server/1.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, "Apple Photos image request failed");
  } catch (error) {
    throw error;
  }

  if (!imageResponse.ok) {
    throw new Error(`Apple Photos image fetch failed with HTTP ${imageResponse.status}`);
  }

  return {
    image: Buffer.from(await imageResponse.arrayBuffer()),
    label: photo.label,
    dateLabel: photo.dateLabel,
  };
}

export async function fetchOriginalPhotoImage(): Promise<Buffer> {
  if (cachedOriginalImage) {
    return cachedOriginalImage;
  }

  const { image } = await fetchPhotoImage();
  cachedOriginalImage = image;
  return image;
}

export async function fetchOriginalPhotoImageFromCacheOrSource(imageDir?: string): Promise<Buffer> {
  let diskCachedImage: Buffer | null = null;

  if (cachedOriginalImage) {
    return cachedOriginalImage;
  }

  if (imageDir) {
    const originalPath = join(imageDir, PHOTOS_ORIGINAL_CACHE_FILENAME);
    if (existsSync(originalPath)) {
      diskCachedImage = readFileSync(originalPath);
      cachedOriginalImage = diskCachedImage;
      return cachedOriginalImage;
    }
  }

  try {
    return await fetchOriginalPhotoImage();
  } catch (error) {
    if (diskCachedImage) {
      cachedOriginalImage = diskCachedImage;
      return cachedOriginalImage;
    }
    throw error;
  }
}

export function fetchFittedPhotoPreviewFromCache(imageDir: string): Buffer | null {
  const previewPath = join(imageDir, PHOTOS_FITTED_PREVIEW_FILENAME);
  return existsSync(previewPath) ? readFileSync(previewPath) : null;
}

export async function fetchFittedPhotoPreviewFromCacheOrSource(imageDir?: string): Promise<Buffer> {
  const diskCachedPreview = imageDir ? fetchFittedPhotoPreviewFromCache(imageDir) : null;
  if (diskCachedPreview) {
    return diskCachedPreview;
  }

  const original = await fetchOriginalPhotoImageFromCacheOrSource(imageDir);
  const fittedPreview = await sharp(await fitPhotoWithinViewport(original)).png().toBuffer();

  if (imageDir) {
    writeFileSync(join(imageDir, PHOTOS_FITTED_PREVIEW_FILENAME), fittedPreview);
  }

  return fittedPreview;
}

let cachedBmp: Buffer | null = null;
let cachedOriginalImage: Buffer | null = null;
let lastPhotosError: string | null = null;

export function resetPhotosCacheForTests(): void {
  cachedBmp = null;
  cachedOriginalImage = null;
  lastPhotosError = null;
}

export function setCachedOriginalPhotoForTests(image: Buffer | null): void {
  cachedOriginalImage = image;
}

export function getLastPhotosError(): string | null {
  return lastPhotosError;
}

export async function renderPhotosBmp(config?: Config): Promise<Buffer> {
  let photo: PhotoImagePayload;
  try {
    photo = await fetchPhotoImage();
    lastPhotosError = null;
  } catch (err) {
    lastPhotosError = err instanceof Error ? err.message : "Apple Photos unavailable";
    console.error("[photos]", lastPhotosError);
    if (!cachedOriginalImage && config?.imageDir) {
      const originalPath = join(config.imageDir, PHOTOS_ORIGINAL_CACHE_FILENAME);
      if (existsSync(originalPath)) {
        cachedOriginalImage = readFileSync(originalPath);
      }
    }
    if (cachedBmp) return cachedBmp;

    const message = lastPhotosError;
    return placeholderBmp(message);
  }

  cachedOriginalImage = photo.image;
  if (config?.imageDir) {
    writeFileSync(join(config.imageDir, PHOTOS_ORIGINAL_CACHE_FILENAME), photo.image);
  }

  const photoGray = await fitPhotoWithinViewport(photo.image);
  if (config?.imageDir) {
    const previewPng = await sharp(photoGray).png().toBuffer();
    writeFileSync(join(config.imageDir, PHOTOS_FITTED_PREVIEW_FILENAME), previewPng);
  }

  const { data, info } = await sharp(photoGray)
    .extend({ bottom: FOOTER_H, background: { r: 255, g: 255, b: 255 } })
    .composite([{ input: Buffer.from(buildFooterSvg("Apple Photos", photo.label, photo.dateLabel)), blend: "over" }])
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grayscale = normalizeRawGrayscalePixels(data as unknown as Buffer, info);
  const dithered = floydSteinberg(grayscale, W, H);
  cachedBmp = encodeGrayscaleBmp(dithered, W, H);
  return cachedBmp;
}

export const photosWidget: WidgetDefinition = {
  name: "photos",
  render: (config) => renderPhotosBmp(config),
  envVars: [
    {
      name: "PHOTOS_SHARED_ALBUM_URL",
      description: "Public iCloud Shared Album URL (preferred over local Photos access)",
      required: false,
    },
    {
      name: "PHOTOS_SHARED_ALBUM_TOKEN",
      description: "Public iCloud Shared Album token, if you do not want to pass the full URL",
      required: false,
    },
    {
      name: "PHOTOS_INDEX",
      description: "Zero-based photo index after sorting album photos newest first",
      required: false,
    },
  ],
};
