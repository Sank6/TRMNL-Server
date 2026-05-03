import sharp from "sharp";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Config } from "../config.js";
import {
  imageToBmp,
  placeholderBmp,
  escapeXml,
  DISPLAY_WIDTH,
  DISPLAY_HEIGHT,
} from "./image-pipeline.js";
import type { WidgetDefinition } from "./types.js";
import { debugLog } from "../utils/logging.js";

const W = DISPLAY_WIDTH;
const H = DISPLAY_HEIGHT;
export const PHOTOS_WIDGET_FILENAME = "widget-photos.bmp";
export const PHOTOS_ORIGINAL_CACHE_FILENAME = "widget-photos-original.bin";
export const PHOTOS_FITTED_PREVIEW_FILENAME = "widget-photos-fitted-preview.png";
export const PHOTOS_INDEX_FILENAME = "widget-photos-index.json";
export const PHOTOS_ALBUM_META_FILENAME = "widget-photos-album-meta.json";
const ICLOUD_SHARED_STREAMS_FALLBACK_HOST = "sharedstreams.icloud.com";
const APPLE_PHOTOS_USER_AGENT = "Photos/5.0 (Macintosh; OS X 10.15.4) AppleWebKit/605.1.15";
const BASE62_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const REQUEST_TIMEOUT_MS = 15_000;
const FETCH_RETRY_ATTEMPTS = 5;
const FETCH_RETRY_DELAY_MS = 1_000;

// ── Apple Photos API types ──────────────────────────────────────────────────

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
  photoIndex: number;
  totalPhotos: number;
  albumPhotos: AlbumPhotoMeta[];
}

interface PhotoImagePayload {
  image: Buffer;
  label: string;
  dateLabel: string;
  photoIndex: number;
  totalPhotos: number;
}

export interface AlbumPhotoMeta {
  index: number;
  caption: string;
  date: string;
  cached?: boolean;
}

interface AlbumCacheMeta {
  total: number;
  photos: AlbumPhotoMeta[] | null;
}

// ── Display-size derivative selection ───────────────────────────────────────

const MIN_DISPLAY_EDGE = Math.min(W, H);
const MAX_DISPLAY_EDGE = Math.max(W, H);

// ── Token resolution ────────────────────────────────────────────────────────

function getToken(): string {
  const token = resolveSharedAlbumToken(
    process.env.PHOTOS_SHARED_ALBUM_URL ?? process.env.PHOTOS_SHARED_ALBUM_TOKEN
  );
  if (!token) throw new Error("Set PHOTOS_SHARED_ALBUM_URL or PHOTOS_SHARED_ALBUM_TOKEN");
  return token;
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

// ── Photo selection from stream ─────────────────────────────────────────────

export function selectPhotoFromStream(
  stream: SharedStreamResponse,
  preferredIndex = 0
): { photo: SelectedPhoto; totalPhotos: number } {
  const photos = listDownloadablePhotos(stream);

  if (photos.length === 0) {
    throw new Error("Apple Photos album is empty or contains no downloadable photos");
  }

  const safeIndex = Math.max(0, Math.min(preferredIndex, photos.length - 1));
  const selected = photos[safeIndex]!;
  const checksum = pickLargestDerivativeChecksum(selected);
  if (!checksum) {
    throw new Error(`No downloadable derivative found for photo ${selected.photoGuid}`);
  }

  return {
    photo: {
      albumName: stream.streamName?.trim() || "Apple Photos",
      caption: selected.caption?.trim() || "",
      createdAt: selected.dateCreated || selected.batchDateCreated || "",
      photoGuid: selected.photoGuid,
      checksum,
    },
    totalPhotos: photos.length,
  };
}

function listDownloadablePhotos(stream: SharedStreamResponse): SharedStreamPhoto[] {
  return [...(stream.photos ?? [])]
    .filter((photo) => Boolean(photo.photoGuid && pickLargestDerivativeChecksum(photo)))
    .sort((a, b) => newestTimestamp(b) - newestTimestamp(a));
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

function base62ToInt(input: string): number | null {
  let result = 0;

  for (const char of input) {
    const index = BASE62_CHARSET.indexOf(char);
    if (index < 0) {
      return null;
    }
    result = result * 62 + index;
  }

  return result;
}

function deriveSharedStreamsPartition(token: string): string | null {
  const partitionKey = token.startsWith("A") ? token.slice(1, 2) : token.slice(1, 3);
  if (!partitionKey) {
    return null;
  }

  const partition = base62ToInt(partitionKey);
  return partition === null ? null : String(partition).padStart(2, "0");
}

function getInitialSharedStreamsHost(token: string): string {
  const partition = deriveSharedStreamsPartition(token);
  return partition ? `p${partition}-sharedstreams.icloud.com` : ICLOUD_SHARED_STREAMS_FALLBACK_HOST;
}

function buildSharedStreamsBaseUrl(host: string, token: string): string {
  return `https://${host}/${token}/sharedstreams`;
}

function replaceBaseUrlHost(baseUrl: string, host: string): string {
  const url = new URL(baseUrl);
  url.host = host;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
}

// ── Footer ──────────────────────────────────────────────────────────────────

function formatPhotoDate(isoDate: string): string {
  if (!isoDate) return "";

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "";

  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const yyyy = parsed.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function buildDateBadgeSvg(dateLabel: string): string {
  if (!dateLabel) return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"/>`;

  const padX = 4;
  const padY = 5;
  const fontSize = 20;
  const boxH = fontSize + padY * 2;
  const boxW = 108;
  const offsetX = 16;
  const offsetY = 16;

  const rx = W - offsetX - boxW;
  const ry = H - offsetY - boxH;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${rx}" y="${ry}" width="${boxW}" height="${boxH}" fill="white"/>
  <text x="${W - offsetX - padX}" y="${ry + Math.round(boxH / 2)}"
    text-anchor="end"
    dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize}" fill="black">${escapeXml(dateLabel)}</text>
</svg>`;
}

// ── Network helpers ─────────────────────────────────────────────────────────

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
      "content-type": "text/plain",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "user-agent": APPLE_PHOTOS_USER_AGENT,
    },
    body: JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, "Apple Photos API request failed");
}

async function readAppleRedirectHost(response: Response): Promise<string | null> {
  const headerHost = response.headers.get("x-apple-mme-host");
  if (headerHost) {
    return headerHost;
  }

  const bodyText = await response.clone().text();
  if (!bodyText) {
    return null;
  }

  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>;
    const redirectHost = payload["X-Apple-MMe-Host"];
    if (typeof redirectHost === "string" && redirectHost) {
      return redirectHost;
    }
  } catch {}

  const match = bodyText.match(/"X-Apple-MMe-Host"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

async function postSharedStreamsJson(
  baseUrl: string,
  path: string,
  payload: unknown
): Promise<{ baseUrl: string; response: Response }> {
  let response = await postJson(`${baseUrl}/${path}`, payload);

  if (response.status === 330) {
    const redirectHost = await readAppleRedirectHost(response);
    if (!redirectHost) {
      throw new Error("Apple Photos API redirect did not provide an iCloud host");
    }

    baseUrl = replaceBaseUrlHost(baseUrl, redirectHost);
    response = await postJson(`${baseUrl}/${path}`, payload);
  }

  return { baseUrl, response };
}

// ── Apple Photos API ────────────────────────────────────────────────────────

async function fetchWebStream(token: string): Promise<{ baseUrl: string; stream: SharedStreamResponse }> {
  const initialBaseUrl = buildSharedStreamsBaseUrl(getInitialSharedStreamsHost(token), token);
  const { baseUrl, response } = await postSharedStreamsJson(
    initialBaseUrl,
    "webstream",
    { streamCtag: null }
  );

  if (!response.ok) {
    throw new Error(`Apple Photos webstream failed with HTTP ${response.status}`);
  }

  return { baseUrl, stream: await response.json() as SharedStreamResponse };
}

// Cache the album stream for 5 min (dashboard use only — main render path bypasses this)
let albumStreamCache: { baseUrl: string; stream: SharedStreamResponse; token: string; expires: number } | null = null;

// Per-index BMP cache for album thumbnails
const albumBmpCache = new Map<number, Buffer>();
let albumTotal = 0; // set during prefetch or disk load

function albumBmpFilename(index: number): string {
  return `widget-photos-album-${index}.bmp`;
}

function originalPhotoPath(imageDir: string): string {
  return join(imageDir, PHOTOS_ORIGINAL_CACHE_FILENAME);
}

function fittedPreviewPath(imageDir: string): string {
  return join(imageDir, PHOTOS_FITTED_PREVIEW_FILENAME);
}

function currentWidgetBmpPath(imageDir: string): string {
  return join(imageDir, PHOTOS_WIDGET_FILENAME);
}

function albumMetaPath(imageDir: string): string {
  return join(imageDir, PHOTOS_ALBUM_META_FILENAME);
}

function saveAlbumToDisk(index: number, bmp: Buffer, imageDir: string): void {
  try { writeFileSync(join(imageDir, albumBmpFilename(index)), bmp); } catch {}
}

function buildAlbumPhotoMetaList(photos: SharedStreamPhoto[]): AlbumPhotoMeta[] {
  return photos.map((photo, index) => ({
    index,
    caption: photo.caption?.trim() || "",
    date: formatPhotoDate(photo.dateCreated || photo.batchDateCreated || ""),
  }));
}

function saveAlbumMetaToDisk(photos: AlbumPhotoMeta[], imageDir: string): void {
  try {
    writeFileSync(albumMetaPath(imageDir), JSON.stringify({ total: photos.length, photos }));
  } catch {}
}

function readAlbumMetaFromDisk(imageDir: string): AlbumCacheMeta | null {
  try {
    const metaPath = albumMetaPath(imageDir);
    if (!existsSync(metaPath)) return null;

    const raw = JSON.parse(readFileSync(metaPath, "utf8")) as {
      total?: unknown;
      photos?: unknown;
    };

    if (typeof raw.total !== "number" || raw.total <= 0) {
      return null;
    }

    const photos = Array.isArray(raw.photos)
      ? raw.photos.flatMap((photo, fallbackIndex) => {
          if (!photo || typeof photo !== "object") {
            return [];
          }

          const candidate = photo as Partial<AlbumPhotoMeta>;
          const index =
            typeof candidate.index === "number" && candidate.index >= 0
              ? candidate.index
              : fallbackIndex;

          return [{
            index,
            caption: typeof candidate.caption === "string" ? candidate.caption : "",
            date: typeof candidate.date === "string" ? candidate.date : "",
          }];
        })
      : null;

    return { total: raw.total, photos };
  } catch {
    return null;
  }
}

function buildAlbumPhotoListForResponse(meta: AlbumCacheMeta): AlbumPhotoMeta[] {
  const photos = meta.photos
    ?? Array.from({ length: meta.total }, (_, index) => ({ index, caption: "", date: "" }));

  return photos.map((photo) => ({
    ...photo,
    cached: albumBmpCache.has(photo.index),
  }));
}

export function loadAlbumCacheFromDisk(imageDir: string): void {
  if (albumBmpCache.size > 0) return;
  try {
    const meta = readAlbumMetaFromDisk(imageDir);
    if (!meta) return;
    let loaded = 0;
    for (let i = 0; i < meta.total; i++) {
      const p = join(imageDir, albumBmpFilename(i));
      if (existsSync(p)) { albumBmpCache.set(i, readFileSync(p)); loaded++; }
    }
    if (loaded > 0) {
      albumTotal = meta.total;
      debugLog(`[photos] loaded ${loaded}/${meta.total} album BMPs from disk`);
    }
  } catch {}
}

export type PrefetchStatus = { status: 'idle' | 'running' | 'done' | 'error'; total: number; done: number; error?: string };
let prefetchState: PrefetchStatus = { status: 'idle', total: 0, done: 0 };
export function getPrefetchStatus(): PrefetchStatus { return { ...prefetchState }; }

async function resolvePhoto(token: string, photoIndex: number): Promise<ResolvedPhoto> {
  const { baseUrl, stream } = await fetchWebStream(token);
  const { photo, totalPhotos } = selectPhotoFromStream(stream, photoIndex);
  const assetUrls = await fetchAssetUrls(baseUrl, photo.photoGuid);
  return {
    imageUrl: buildAssetUrl(assetUrls, photo.checksum),
    label: photo.caption || photo.albumName,
    dateLabel: formatPhotoDate(photo.createdAt),
    photoIndex,
    totalPhotos,
    albumPhotos: buildAlbumPhotoMetaList(listDownloadablePhotos(stream)),
  };
}

async function fetchAssetUrls(baseUrl: string, photoGuids: string | string[]): Promise<SharedAssetUrlsResponse> {
  const guids = Array.isArray(photoGuids) ? photoGuids : [photoGuids];
  const { response } = await postSharedStreamsJson(baseUrl, "webasseturls", { photoGuids: guids });
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

function loadPhotoIndex(imageDir?: string): number {
  // env var acts as a fixed override — cycling is disabled when set
  const envIndex = parseInt(process.env.PHOTOS_INDEX ?? "", 10);
  if (Number.isFinite(envIndex) && envIndex >= 0) return envIndex;

  if (imageDir) {
    try {
      const indexPath = join(imageDir, PHOTOS_INDEX_FILENAME);
      if (existsSync(indexPath)) {
        const data = JSON.parse(readFileSync(indexPath, "utf8")) as { index?: unknown; lastRendered?: unknown };
        if (typeof data.index === "number" && data.index >= 0) {
          return data.index;
        }
      }
    } catch {}
  }

  return 0;
}

function loadLastRenderedIndex(imageDir?: string): number | null {
  if (process.env.PHOTOS_INDEX) return null;
  if (!imageDir) return null;
  try {
    const indexPath = join(imageDir, PHOTOS_INDEX_FILENAME);
    if (existsSync(indexPath)) {
      const data = JSON.parse(readFileSync(indexPath, "utf8")) as { lastRendered?: unknown };
      if (typeof data.lastRendered === "number" && data.lastRendered >= 0) {
        return data.lastRendered;
      }
    }
  } catch {}
  return null;
}

function savePhotoIndex(currentIndex: number, nextIndex: number, imageDir?: string): void {
  // Don't persist when env var override is in use
  if (process.env.PHOTOS_INDEX) return;
  if (!imageDir) return;
  try {
    writeFileSync(join(imageDir, PHOTOS_INDEX_FILENAME), JSON.stringify({ index: nextIndex, lastRendered: currentIndex }));
  } catch {}
}

async function fetchPhotoImage(imageDir?: string): Promise<PhotoImagePayload> {
  const token = resolveSharedAlbumToken(
    process.env.PHOTOS_SHARED_ALBUM_URL ?? process.env.PHOTOS_SHARED_ALBUM_TOKEN
  );

  if (!token) {
    throw new Error("Set PHOTOS_SHARED_ALBUM_URL or PHOTOS_SHARED_ALBUM_TOKEN");
  }

  const photoIndex = loadPhotoIndex(imageDir);
  const photo = await resolvePhoto(token, photoIndex);

  if (imageDir) {
    saveAlbumMetaToDisk(photo.albumPhotos, imageDir);
  }

  const imageResponse = await fetchWithRetries(photo.imageUrl, {
    headers: { "user-agent": "xteink-server/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, "Apple Photos image request failed");

  if (!imageResponse.ok) {
    throw new Error(`Apple Photos image fetch failed with HTTP ${imageResponse.status}`);
  }

  return {
    image: Buffer.from(await imageResponse.arrayBuffer()),
    label: photo.label,
    dateLabel: photo.dateLabel,
    photoIndex: photo.photoIndex,
    totalPhotos: photo.totalPhotos,
  };
}

// ── Caching ─────────────────────────────────────────────────────────────────

let cachedBmp: Buffer | null = null;
let cachedOriginalImage: Buffer | null = null;
let lastPhotosError: string | null = null;

export function resetPhotosCacheForTests(): void {
  cachedBmp = null;
  cachedOriginalImage = null;
  lastPhotosError = null;
  albumStreamCache = null;
  albumBmpCache.clear();
  albumTotal = 0;
  prefetchState = { status: 'idle', total: 0, done: 0 };
}

export function setCachedOriginalPhotoForTests(image: Buffer | null): void {
  cachedOriginalImage = image;
}

export function getLastPhotosError(): string | null {
  return lastPhotosError;
}

export async function fetchOriginalPhotoImage(): Promise<Buffer> {
  if (cachedOriginalImage) {
    return cachedOriginalImage;
  }

  const { image } = await fetchPhotoImage(undefined);
  cachedOriginalImage = image;
  return image;
}

export function fetchCurrentPhotoBmpFromCache(imageDir: string): Buffer | null {
  const widgetBmpPath = currentWidgetBmpPath(imageDir);
  return existsSync(widgetBmpPath) ? readFileSync(widgetBmpPath) : null;
}

function findRenderedAlbumIndex(imageDir?: string): number | null {
  if (!imageDir) {
    return null;
  }

  const currentBmp = fetchCurrentPhotoBmpFromCache(imageDir);
  if (!currentBmp) {
    return null;
  }

  for (const [index, bmp] of albumBmpCache.entries()) {
    if (bmp.equals(currentBmp)) {
      return index;
    }
  }

  const meta = readAlbumMetaFromDisk(imageDir);
  if (!meta) {
    return null;
  }

  for (let index = 0; index < meta.total; index++) {
    const albumBmpPath = join(imageDir, albumBmpFilename(index));
    if (!existsSync(albumBmpPath)) {
      continue;
    }

    try {
      if (readFileSync(albumBmpPath).equals(currentBmp)) {
        return index;
      }
    } catch {}
  }

  return null;
}

export function fetchOriginalPhotoImageFromCache(imageDir?: string): Buffer | null {
  if (cachedOriginalImage) {
    return cachedOriginalImage;
  }

  if (!imageDir) {
    return null;
  }

  const originalPath = originalPhotoPath(imageDir);
  if (!existsSync(originalPath)) {
    return null;
  }

  cachedOriginalImage = readFileSync(originalPath);
  return cachedOriginalImage;
}

export async function fetchOriginalPhotoImageFromCacheOrSource(imageDir?: string): Promise<Buffer> {
  const diskCachedImage = fetchOriginalPhotoImageFromCache(imageDir);
  if (diskCachedImage) {
    return diskCachedImage;
  }

  return await fetchOriginalPhotoImage();
}

export function fetchFittedPhotoPreviewFromCache(imageDir: string): Buffer | null {
  const previewPath = fittedPreviewPath(imageDir);
  return existsSync(previewPath) ? readFileSync(previewPath) : null;
}

export async function fetchFittedPhotoPreviewFromCacheOrOriginalCache(
  imageDir?: string
): Promise<Buffer | null> {
  const diskCachedPreview = imageDir ? fetchFittedPhotoPreviewFromCache(imageDir) : null;
  if (diskCachedPreview) {
    return diskCachedPreview;
  }

  const original = fetchOriginalPhotoImageFromCache(imageDir);
  if (!original) {
    return null;
  }

  const fittedPreview = await sharp(original)
    .rotate()
    .resize(W, H, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  if (imageDir) {
    writeFileSync(fittedPreviewPath(imageDir), fittedPreview);
  }

  return fittedPreview;
}

export async function fetchFittedPhotoPreviewFromCacheOrSource(imageDir?: string): Promise<Buffer> {
  const cachedPreview = await fetchFittedPhotoPreviewFromCacheOrOriginalCache(imageDir);
  if (cachedPreview) {
    return cachedPreview;
  }

  const original = await fetchOriginalPhotoImageFromCacheOrSource(imageDir);
  const fittedPreview = await sharp(original)
    .rotate()
    .resize(W, H, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  if (imageDir) {
    writeFileSync(fittedPreviewPath(imageDir), fittedPreview);
  }

  return fittedPreview;
}

// ── Render ──────────────────────────────────────────────────────────────────

export async function renderPhotosBmp(config?: Config): Promise<Buffer> {
  // Fast path: use the prefetched album cache if available
  if (config?.imageDir) loadAlbumCacheFromDisk(config.imageDir);
  const currentIndex = loadPhotoIndex(config?.imageDir);
  if (albumBmpCache.has(currentIndex) && albumTotal > 0) {
    const bmp = albumBmpCache.get(currentIndex)!;
    const nextIndex = (currentIndex + 1) % albumTotal;
    savePhotoIndex(currentIndex, nextIndex, config?.imageDir);
    cachedBmp = bmp;
    lastPhotosError = null;
    debugLog(`[photos] rendered photo ${currentIndex + 1}/${albumTotal} from cache → next index ${nextIndex}`);
    return bmp;
  }

  let photo: PhotoImagePayload;
  try {
    photo = await fetchPhotoImage(config?.imageDir);
    lastPhotosError = null;
  } catch (err) {
    lastPhotosError = err instanceof Error ? err.message : "Apple Photos unavailable";
    console.error("[photos]", lastPhotosError);
    if (!cachedOriginalImage && config?.imageDir) {
      const diskCachedOriginal = fetchOriginalPhotoImageFromCache(config.imageDir);
      if (diskCachedOriginal) {
        cachedOriginalImage = diskCachedOriginal;
      }
    }
    if (!cachedBmp && config?.imageDir) {
      const diskCachedBmp = fetchCurrentPhotoBmpFromCache(config.imageDir);
      if (diskCachedBmp) {
        cachedBmp = diskCachedBmp;
        lastPhotosError = null;
        console.warn("[photos] served disk-cached widget BMP after source fetch failed");
      }
    }
    if (cachedBmp) return cachedBmp;

    return placeholderBmp(
      lastPhotosError?.includes("PHOTOS_SHARED_ALBUM") ? "Missing Config" : (lastPhotosError ?? "Unknown error")
    );
  }

  // Advance to the next photo for the following render cycle
  const nextIndex = (photo.photoIndex + 1) % photo.totalPhotos;
  savePhotoIndex(photo.photoIndex, nextIndex, config?.imageDir);
  debugLog(`[photos] rendered photo ${photo.photoIndex + 1}/${photo.totalPhotos} → next index ${nextIndex}`);

  cachedOriginalImage = photo.image;
  if (config?.imageDir) {
    writeFileSync(originalPhotoPath(config.imageDir), photo.image);
  }

  // Save a fitted preview PNG for the dashboard
  if (config?.imageDir) {
    const previewPng = await sharp(photo.image)
      .rotate()
      .resize(W, H, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    writeFileSync(fittedPreviewPath(config.imageDir), previewPng);
  }

  // Render: cover-fit into full display, then overlay the date badge
  cachedBmp = await imageToBmp(photo.image, {
    overlay: buildDateBadgeSvg(photo.dateLabel),
  });
  albumBmpCache.set(photo.photoIndex, cachedBmp);
  albumTotal = photo.totalPhotos;
  if (config?.imageDir) {
    saveAlbumToDisk(photo.photoIndex, cachedBmp, config.imageDir);
  }
  return cachedBmp;
}

// ── Album API helpers ────────────────────────────────────────────────────────

export async function fetchAlbumPhotoList(imageDir?: string): Promise<{
  photos: AlbumPhotoMeta[];
  total: number;
  currentIndex: number;
  cached: number;
}> {
  if (imageDir) loadAlbumCacheFromDisk(imageDir);
  const renderedIndex = findRenderedAlbumIndex(imageDir);
  const lastRendered = loadLastRenderedIndex(imageDir);
  const currentIndex =
    renderedIndex !== null ? renderedIndex : (lastRendered !== null ? lastRendered : loadPhotoIndex(imageDir));
  const cached = albumBmpCache.size;

  if (imageDir) {
    const diskMeta = readAlbumMetaFromDisk(imageDir);
    if (diskMeta) {
      return {
        photos: buildAlbumPhotoListForResponse(diskMeta),
        total: diskMeta.total,
        currentIndex,
        cached,
      };
    }
  }

  return {
    photos: [],
    total: 0,
    currentIndex,
    cached,
  };
}

export function renderPhotoAtIndex(index: number): Buffer {
  const bmp = albumBmpCache.get(index);
  if (!bmp) throw new Error(`Photo ${index} not in cache — run Update Album first`);
  return bmp;
}

export async function prefetchAlbum(imageDir?: string): Promise<void> {
  if (prefetchState.status === 'running') return; // already in progress
  prefetchState = { status: 'running', total: 0, done: 0 };
  albumStreamCache = null;
  albumBmpCache.clear();
  debugLog("[photos] album prefetch started");

  try {
    const token = getToken();
    const { baseUrl, stream } = await fetchWebStream(token);
    albumStreamCache = { baseUrl, stream, token, expires: Date.now() + 5 * 60 * 1000 };

    const sorted = listDownloadablePhotos(stream);

    prefetchState.total = sorted.length;
    albumTotal = sorted.length;
    const albumPhotos = buildAlbumPhotoMetaList(sorted);
    if (imageDir) saveAlbumMetaToDisk(albumPhotos, imageDir);

    // Single batch call for all asset URLs
    const allGuids = sorted.map((p) => p.photoGuid);
    const assetUrlsResponse = await fetchAssetUrls(baseUrl, allGuids);

    // Download and dither with limited concurrency
    const CONCURRENCY = 4;
    const queue: Array<[number, SharedStreamPhoto]> = sorted.map((p, i) => [i, p]);

    async function worker(): Promise<void> {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const [index, photo] = item;
        const checksum = pickLargestDerivativeChecksum(photo);
        if (!checksum) { prefetchState.done++; continue; }
        try {
          const imageUrl = buildAssetUrl(assetUrlsResponse, checksum);
          const imageResponse = await fetchWithRetries(
            imageUrl,
            { headers: { "user-agent": "xteink-server/1.0" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
            "image fetch failed"
          );
          if (imageResponse.ok) {
            const bmp = await imageToBmp(Buffer.from(await imageResponse.arrayBuffer()), {
              overlay: buildDateBadgeSvg(formatPhotoDate(photo.dateCreated || photo.batchDateCreated || "")),
            });
            albumBmpCache.set(index, bmp);
            if (imageDir) saveAlbumToDisk(index, bmp, imageDir);
          }
        } catch { /* skip failed photos */ }
        prefetchState.done++;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    prefetchState = { status: 'done', total: sorted.length, done: prefetchState.done };
    debugLog(`[photos] album prefetch completed ${prefetchState.done}/${sorted.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    prefetchState = {
      status: 'error',
      total: prefetchState.total,
      done: prefetchState.done,
      error: message,
    };
    console.error("[photos] album prefetch failed:", message);
  }
}

export function setPhotoIndex(index: number, imageDir?: string): void {
  // Save index as both current and next; renderPhotosBmp will advance it after rendering
  savePhotoIndex(index, index, imageDir);
}

export const photosWidget: WidgetDefinition = {
  name: "photos",
  render: (config) => renderPhotosBmp(config),
  dashboard: {
    previewRefreshMultiplier: 2,
    previewRefreshMode: "regenerate",
    actions: [
      { action: "photos:view-album", label: "View Album" },
      { action: "photos:update-album", label: "Update Album" },
    ],
  },
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
