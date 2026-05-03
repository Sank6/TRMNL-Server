import { writeFileSync } from "fs";

// TRMNL display: 800x480, 1-bit monochrome BMP
const width = 800;
const height = 480;

// Row stride must be padded to 4-byte boundary
// For 1-bit: ceil(800 / 32) * 4 = 25 * 4 = 100 bytes per row
const rowStride = Math.ceil(width / 32) * 4;
const pixelDataSize = rowStride * height;
const colorTableSize = 8; // 2 entries × 4 bytes
const headerSize = 14 + 40;
const pixelDataOffset = headerSize + colorTableSize;
const fileSize = pixelDataOffset + pixelDataSize;

const buf = Buffer.alloc(fileSize, 0);

// ── File header (14 bytes) ──────────────────────────────────────────────
buf.write("BM", 0, "ascii");
buf.writeUInt32LE(fileSize, 2);
buf.writeUInt16LE(0, 6);
buf.writeUInt16LE(0, 8);
buf.writeUInt32LE(pixelDataOffset, 10);

// ── DIB header – BITMAPINFOHEADER (40 bytes) ───────────────────────────
buf.writeUInt32LE(40, 14);             // header size
buf.writeInt32LE(width, 18);           // width in pixels
buf.writeInt32LE(-height, 22);         // negative = top-down row order
buf.writeUInt16LE(1, 26);             // color planes
buf.writeUInt16LE(1, 28);             // bits per pixel (monochrome)
buf.writeUInt32LE(0, 30);             // compression: BI_RGB
buf.writeUInt32LE(pixelDataSize, 34);  // raw image size
buf.writeInt32LE(2835, 38);           // X pixels/meter (~72 DPI)
buf.writeInt32LE(2835, 42);           // Y pixels/meter
buf.writeUInt32LE(2, 46);             // colors in table
buf.writeUInt32LE(2, 50);             // important colors

// ── Color table: index 0 = black, index 1 = white ──────────────────────
buf.writeUInt32LE(0x00000000, 54);    // black
buf.writeUInt32LE(0x00FFFFFF, 58);    // white

// ── Pixel data: all 1s = all white ─────────────────────────────────────
buf.fill(0xff, pixelDataOffset);

const outPath = new URL("../public/images/default.bmp", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
writeFileSync(outPath, buf);
console.log(`Generated default.bmp (${fileSize} bytes)`);
