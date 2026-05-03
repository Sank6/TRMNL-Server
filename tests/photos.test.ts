import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  PHOTOS_ALBUM_META_FILENAME,
  PHOTOS_FITTED_PREVIEW_FILENAME,
  PHOTOS_INDEX_FILENAME,
  PHOTOS_ORIGINAL_CACHE_FILENAME,
  PHOTOS_WIDGET_FILENAME,
  buildAssetUrl,
  fetchAlbumPhotoList,
  fetchFittedPhotoPreviewFromCache,
  fetchOriginalPhotoImage,
  fetchOriginalPhotoImageFromCacheOrSource,
  getPrefetchStatus,
  prefetchAlbum,
  renderPhotosBmp,
  resolveSharedAlbumToken,
  resetPhotosCacheForTests,
  setCachedOriginalPhotoForTests,
  shouldRetryAppleFetchError,
  selectPhotoFromStream,
} from "../src/widgets/photos.js";
import { TEST_CONFIG } from "./helpers.js";

const ORIGINAL_SHARED_ALBUM_TOKEN = process.env.PHOTOS_SHARED_ALBUM_TOKEN;
const ORIGINAL_SHARED_ALBUM_URL = process.env.PHOTOS_SHARED_ALBUM_URL;
const APPLE_PHOTOS_USER_AGENT = "Photos/5.0 (Macintosh; OS X 10.15.4) AppleWebKit/605.1.15";

describe("photos widget helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_SHARED_ALBUM_TOKEN === undefined) delete process.env.PHOTOS_SHARED_ALBUM_TOKEN;
    else process.env.PHOTOS_SHARED_ALBUM_TOKEN = ORIGINAL_SHARED_ALBUM_TOKEN;
    if (ORIGINAL_SHARED_ALBUM_URL === undefined) delete process.env.PHOTOS_SHARED_ALBUM_URL;
    else process.env.PHOTOS_SHARED_ALBUM_URL = ORIGINAL_SHARED_ALBUM_URL;
    resetPhotosCacheForTests();
  });

  it("returns the cached original photo for dashboard comparison", async () => {
    const cached = Buffer.from("cached-original");
    setCachedOriginalPhotoForTests(cached);

    await expect(fetchOriginalPhotoImage()).resolves.toBe(cached);
  });

  it("returns the disk-cached original photo for dashboard comparison", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "photos-cache-"));
    const cached = Buffer.from("disk-cached-original");
    writeFileSync(join(imageDir, PHOTOS_ORIGINAL_CACHE_FILENAME), cached);

    await expect(fetchOriginalPhotoImageFromCacheOrSource(imageDir)).resolves.toEqual(cached);
  });

  it("returns the disk-cached fitted preview image", () => {
    const imageDir = mkdtempSync(join(tmpdir(), "photos-preview-"));
    const cached = Buffer.from("fitted-preview");
    writeFileSync(join(imageDir, PHOTOS_FITTED_PREVIEW_FILENAME), cached);

    expect(fetchFittedPhotoPreviewFromCache(imageDir)).toEqual(cached);
  });

  it("falls back to the disk-cached widget bmp when Apple Photos is unavailable", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "photos-widget-cache-"));
    const cached = Buffer.from("cached-widget-bmp");
    writeFileSync(join(imageDir, PHOTOS_WIDGET_FILENAME), cached);

    await expect(renderPhotosBmp({ ...TEST_CONFIG, imageDir })).resolves.toEqual(cached);
  });

  it("caches the currently rendered photo as an album thumbnail", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "photos-render-cache-"));
    const imageBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2ZbXcAAAAASUVORK5CYII=",
      "base64"
    );
    process.env.PHOTOS_SHARED_ALBUM_TOKEN = "test-token";
    delete process.env.PHOTOS_SHARED_ALBUM_URL;

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        streamName: "Family",
        photos: [{
          photoGuid: "newest",
          dateCreated: "2024-03-04T10:00:00Z",
          derivatives: {
            fit: { checksum: "abc123", fileSize: "6000", width: "900", height: "600" },
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        locations: {
          loc: { scheme: "https", hosts: ["example.com"] },
        },
        items: {
          abc123: { url_location: "loc", url_path: "/photo.jpg" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(imageBuffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      }));

    await renderPhotosBmp({ ...TEST_CONFIG, imageDir });

    expect(existsSync(join(imageDir, "widget-photos-album-0.bmp"))).toBe(true);
  });

  it("returns disk album metadata with per-photo cache state", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "photos-album-cache-"));
    writeFileSync(
      join(imageDir, PHOTOS_ALBUM_META_FILENAME),
      JSON.stringify({
        total: 2,
        photos: [
          { index: 0, caption: "Beach", date: "04-03-2024" },
          { index: 1, caption: "Lake", date: "03-03-2024" },
        ],
      })
    );
    writeFileSync(join(imageDir, "widget-photos-album-1.bmp"), Buffer.from("cached-album-bmp"));

    await expect(fetchAlbumPhotoList(imageDir)).resolves.toEqual({
      photos: [
        { index: 0, caption: "Beach", date: "04-03-2024", cached: false },
        { index: 1, caption: "Lake", date: "03-03-2024", cached: true },
      ],
      total: 2,
      currentIndex: 0,
      cached: 1,
    });
  });

  it("uses the actual rendered widget bmp to determine the current album photo", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "photos-album-current-"));
    const albumZero = Buffer.from("album-zero");
    const albumOne = Buffer.from("album-one");

    writeFileSync(
      join(imageDir, PHOTOS_ALBUM_META_FILENAME),
      JSON.stringify({
        total: 2,
        photos: [
          { index: 0, caption: "Beach", date: "04-03-2024" },
          { index: 1, caption: "Lake", date: "03-03-2024" },
        ],
      })
    );
    writeFileSync(join(imageDir, PHOTOS_INDEX_FILENAME), JSON.stringify({ index: 1, lastRendered: 0 }));
    writeFileSync(join(imageDir, "widget-photos-album-0.bmp"), albumZero);
    writeFileSync(join(imageDir, "widget-photos-album-1.bmp"), albumOne);
    writeFileSync(join(imageDir, PHOTOS_WIDGET_FILENAME), albumOne);

    await expect(fetchAlbumPhotoList(imageDir)).resolves.toEqual({
      photos: [
        { index: 0, caption: "Beach", date: "04-03-2024", cached: true },
        { index: 1, caption: "Lake", date: "03-03-2024", cached: true },
      ],
      total: 2,
      currentIndex: 1,
      cached: 2,
    });
  });

  it("logs album prefetch failures so dashboard errors are visible", async () => {
    delete process.env.PHOTOS_SHARED_ALBUM_TOKEN;
    delete process.env.PHOTOS_SHARED_ALBUM_URL;
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await prefetchAlbum();

    expect(getPrefetchStatus()).toEqual({
      status: "error",
      total: 0,
      done: 0,
      error: "Set PHOTOS_SHARED_ALBUM_URL or PHOTOS_SHARED_ALBUM_TOKEN",
    });
    expect(consoleLog).toHaveBeenCalledWith("[photos] album prefetch started");
    expect(consoleError).toHaveBeenCalledWith(
      "[photos] album prefetch failed:",
      "Set PHOTOS_SHARED_ALBUM_URL or PHOTOS_SHARED_ALBUM_TOKEN"
    );
  });

  it("retries transient Apple Photos network failures", () => {
    expect(shouldRetryAppleFetchError(new Error("read ECONNRESET"))).toBe(true);
    expect(shouldRetryAppleFetchError(new Error("socket hang up"))).toBe(true);
    expect(shouldRetryAppleFetchError(new Error("HTTP 403"))).toBe(false);
  });

  it("starts Apple Photos requests on the token partition host with app-style headers", async () => {
    const imageBuffer = Buffer.from("original-image");
    process.env.PHOTOS_SHARED_ALBUM_TOKEN = "B01test";
    delete process.env.PHOTOS_SHARED_ALBUM_URL;

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        streamName: "Family",
        photos: [{
          photoGuid: "newest",
          dateCreated: "2024-03-04T10:00:00Z",
          derivatives: {
            fit: { checksum: "abc123", fileSize: "6000", width: "900", height: "600" },
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        locations: {
          loc: { scheme: "https", hosts: ["example.com"] },
        },
        items: {
          abc123: { url_location: "loc", url_path: "/photo.jpg" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(imageBuffer, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));

    await expect(fetchOriginalPhotoImage()).resolves.toEqual(imageBuffer);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://p01-sharedstreams.icloud.com/B01test/sharedstreams/webstream"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "text/plain",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "user-agent": APPLE_PHOTOS_USER_AGENT,
      },
    });
  });

  it("follows Apple Photos redirects when the host is only present in the 330 response body", async () => {
    const imageBuffer = Buffer.from("redirected-image");
    process.env.PHOTOS_SHARED_ALBUM_TOKEN = "B01test";
    delete process.env.PHOTOS_SHARED_ALBUM_URL;

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        "X-Apple-MMe-Host": "p55-sharedstreams.icloud.com",
      }), { status: 330, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        streamName: "Family",
        photos: [{
          photoGuid: "newest",
          dateCreated: "2024-03-04T10:00:00Z",
          derivatives: {
            fit: { checksum: "abc123", fileSize: "6000", width: "900", height: "600" },
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        locations: {
          loc: { scheme: "https", hosts: ["example.com"] },
        },
        items: {
          abc123: { url_location: "loc", url_path: "/photo.jpg" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(imageBuffer, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));

    await expect(fetchOriginalPhotoImage()).resolves.toEqual(imageBuffer);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://p01-sharedstreams.icloud.com/B01test/sharedstreams/webstream"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://p55-sharedstreams.icloud.com/B01test/sharedstreams/webstream"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://p55-sharedstreams.icloud.com/B01test/sharedstreams/webasseturls"
    );
  });

  it("extracts a shared album token from a public iCloud URL", () => {
    expect(
      resolveSharedAlbumToken("https://www.icloud.com/sharedalbum/#B12GfnH8tC0ZuK")
    ).toBe("B12GfnH8tC0ZuK");
  });

  it("accepts a raw shared album token", () => {
    expect(resolveSharedAlbumToken("B12GfnH8tC0ZuK")).toBe("B12GfnH8tC0ZuK");
  });

  it("selects the newest photo and the smallest display-sized derivative", () => {
    const selected = selectPhotoFromStream({
      streamName: "Family",
      photos: [
        {
          photoGuid: "older",
          dateCreated: "2024-03-01T10:00:00Z",
          derivatives: {
            small: { checksum: "old-small", fileSize: "1200" },
            large: { checksum: "old-large", fileSize: "5400" },
          },
        },
        {
          photoGuid: "newest",
          caption: "Beach",
          dateCreated: "2024-03-04T10:00:00Z",
          derivatives: {
            medium: { checksum: "new-medium", fileSize: "8000" },
            large: { checksum: "new-large", fileSize: "12000" },
          },
        },
      ],
    });

    expect(selected.totalPhotos).toBe(2);
    expect(selected.photo.photoGuid).toBe("newest");
    expect(selected.photo.albumName).toBe("Family");
    expect(selected.photo.caption).toBe("Beach");
    expect(selected.photo.checksum).toBe("new-medium");
  });

  it("prefers the smallest derivative that still fits the display", () => {
    const selected = selectPhotoFromStream({
      streamName: "Family",
      photos: [
        {
          photoGuid: "newest",
          caption: "Beach",
          dateCreated: "2024-03-04T10:00:00Z",
          derivatives: {
            tooSmall: { checksum: "small", fileSize: "3000", width: "640", height: "360" },
            justRight: { checksum: "fit", fileSize: "6000", width: "900", height: "600" },
            huge: { checksum: "huge", fileSize: "18000", width: "3000", height: "2000" },
          },
        },
      ],
    });

    expect(selected.photo.checksum).toBe("fit");
  });

  it("falls back to the largest derivative when none are display-sized", () => {
    const selected = selectPhotoFromStream({
      streamName: "Family",
      photos: [
        {
          photoGuid: "newest",
          caption: "Beach",
          dateCreated: "2024-03-04T10:00:00Z",
          derivatives: {
            small: { checksum: "small", fileSize: "3000", width: "640", height: "360" },
            medium: { checksum: "medium", fileSize: "6000", width: "700", height: "394" },
          },
        },
      ],
    });

    expect(selected.photo.checksum).toBe("medium");
  });

  it("builds an absolute asset URL from the webasseturls payload", () => {
    expect(buildAssetUrl({
      locations: {
        "cvws.icloud-content.com": {
          scheme: "https",
          hosts: ["cvws.icloud-content.com"],
        },
      },
      items: {
        abc123: {
          url_location: "cvws.icloud-content.com",
          url_path: "/S/example.JPG",
        },
      },
    }, "abc123")).toBe("https://cvws.icloud-content.com/S/example.JPG");
  });
});
