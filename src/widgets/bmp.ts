/**
 * Encodes a raw grayscale pixel buffer (1 byte per pixel, row-major, top-down)
 * into a 1-bit monochrome BMP — the format TRMNL firmware expects.
 *
 * Pixels >= threshold are white (bit=1), below are black (bit=0).
 * Bits are packed MSB-first; rows are padded to a 4-byte boundary.
 */
export function encodeGrayscaleBmp(
  pixels: Buffer,
  width: number,
  height: number,
  threshold = 128
): Buffer {
  // 1-bit BMP row stride: ceil(width / 32) * 4 bytes
  const rowStride = Math.ceil(width / 32) * 4;
  const pixelDataSize = rowStride * height;
  const colorTableSize = 8;               // 2 palette entries × 4 bytes
  const pixelDataOffset = 14 + 40 + colorTableSize; // = 62
  const fileSize = pixelDataOffset + pixelDataSize;

  const buf = Buffer.alloc(fileSize, 0);

  // ── File header (14 bytes) ──────────────────────────────────────────────
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(pixelDataOffset, 10);

  // ── BITMAPINFOHEADER (40 bytes) ─────────────────────────────────────────
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);    // positive = standard bottom-up BMP (required by TRMNL firmware)
  buf.writeUInt16LE(1, 26);        // colour planes
  buf.writeUInt16LE(1, 28);        // 1 bit per pixel
  buf.writeUInt32LE(0, 30);        // BI_RGB
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38);      // ~72 DPI
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(2, 46);
  buf.writeUInt32LE(2, 50);

  // ── Colour table: index 0 = black, index 1 = white ─────────────────────
  buf.writeUInt32LE(0x00000000, 54);
  buf.writeUInt32LE(0x00FFFFFF, 58);

  // ── Pixel data: pack 8 pixels per byte, MSB = leftmost pixel ───────────
  // Standard BMP stores rows bottom-up: file row 0 = image bottom row.
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;  // flip: file row y reads source row srcRow
    for (let x = 0; x < width; x++) {
      if (pixels[srcRow * width + x] >= threshold) {
        // set bit = 1 (white)
        const byteOff = pixelDataOffset + y * rowStride + (x >> 3);
        buf[byteOff] |= 1 << (7 - (x & 7));
      }
    }
  }

  return buf;
}
