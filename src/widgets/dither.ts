/**
 * Floyd-Steinberg error-diffusion dithering.
 *
 * Converts a grayscale pixel buffer (1 byte per pixel, row-major, top-down)
 * to a 1-bit approximation where every output pixel is exactly 0 (black)
 * or 255 (white). Pass the result directly to encodeGrayscaleBmp.
 */
export function floydSteinberg(
  pixels: Buffer,
  width: number,
  height: number
): Buffer {
  const err = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) err[i] = pixels[i];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = err[i];
      const nv = old < 128 ? 0 : 255;
      err[i] = nv;
      const e = old - nv;

      if (x + 1 < width)        err[i + 1]           += (e * 7) / 16;
      if (y + 1 < height) {
        if (x > 0)               err[i + width - 1]   += (e * 3) / 16;
                                 err[i + width]       += (e * 5) / 16;
        if (x + 1 < width)       err[i + width + 1]  +=  e       / 16;
      }
    }
  }

  const out = Buffer.alloc(pixels.length);
  for (let i = 0; i < err.length; i++) {
    out[i] = err[i] < 128 ? 0 : 255;
  }
  return out;
}
