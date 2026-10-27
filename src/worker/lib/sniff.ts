/** Raster image formats we accept for emoji and profile pictures, detected from file contents. */
export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Identifies an image by its magic bytes (the browser-supplied type can be anything). */
export function detectImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v))
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Reads the first bytes of a stored object and detects its image type. */
export async function sniffStoredImage(bucket: R2Bucket, key: string): Promise<ImageType | null> {
  const obj = await bucket.get(key, { range: { offset: 0, length: 16 } });
  if (!obj) return null;
  return detectImageType(new Uint8Array(await obj.arrayBuffer()));
}
