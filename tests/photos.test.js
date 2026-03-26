import { describe, expect, it } from "vitest";
import { buildAssetUrl, resolveSharedAlbumToken, selectPhotoFromStream, } from "../src/widgets/photos.js";
describe("photos widget helpers", () => {
    it("extracts a shared album token from a public iCloud URL", () => {
        expect(resolveSharedAlbumToken("https://www.icloud.com/sharedalbum/#B12GfnH8tC0ZuK")).toBe("B12GfnH8tC0ZuK");
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
//# sourceMappingURL=photos.test.js.map
