import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  PHOTOS_FITTED_PREVIEW_FILENAME,
  PHOTOS_ORIGINAL_CACHE_FILENAME,
  buildAssetUrl,
  fetchFittedPhotoPreviewFromCache,
  fetchOriginalPhotoImage,
  fetchOriginalPhotoImageFromCacheOrSource,
  resolveSharedAlbumToken,
  resetPhotosCacheForTests,
  setCachedOriginalPhotoForTests,
  shouldRetryAppleFetchError,
  selectPhotoFromStream,
} from "../src/widgets/photos.js";

describe("photos widget helpers", () => {
  afterEach(() => {
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

  it("retries transient Apple Photos network failures", () => {
    expect(shouldRetryAppleFetchError(new Error("read ECONNRESET"))).toBe(true);
    expect(shouldRetryAppleFetchError(new Error("socket hang up"))).toBe(true);
    expect(shouldRetryAppleFetchError(new Error("HTTP 403"))).toBe(false);
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

    expect(selected.photoGuid).toBe("newest");
    expect(selected.albumName).toBe("Family");
    expect(selected.caption).toBe("Beach");
    expect(selected.checksum).toBe("new-medium");
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

    expect(selected.checksum).toBe("fit");
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

    expect(selected.checksum).toBe("medium");
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
