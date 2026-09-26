const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export function decodeInputImage(value) {
  if (typeof value !== 'string' || value.length > 4 * MAX_IMAGE_BYTES / 3 + 128) {
    throw new TypeError('Image must be a bounded base64 data URL');
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new TypeError('Unsupported image data URL');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
    throw new TypeError('Invalid image bytes or image size');
  }
  const mime = match[1];
  const png = mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new TypeError('Image signature does not match its MIME type');
  return { bytes, mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.slice(6) };
}

export const INPUT_IMAGE_MAX_BYTES = MAX_IMAGE_BYTES;
