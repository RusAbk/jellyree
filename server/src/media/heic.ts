import { extname } from 'path';
import sharp from 'sharp';
import heicConvert from 'heic-convert';

type HeicConvert = (options: {
  buffer: Buffer;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<Buffer | Uint8Array | ArrayBuffer>;

const convertHeic = heicConvert as HeicConvert;

export function isHeicFile(mimeType: string, filename: string): boolean {
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes('heic') || normalizedMime.includes('heif')) return true;
  const ext = extname(filename).replace(/^\./, '').toLowerCase();
  return ext === 'heic' || ext === 'heif';
}

export async function convertHeicToJpegBuffer(sourceBuffer: Buffer, quality = 0.92): Promise<Buffer> {
  const converted = await convertHeic({
    buffer: sourceBuffer,
    format: 'JPEG',
    quality,
  });
  if (converted instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(converted));
  }
  return Buffer.from(converted);
}

export async function normalizeImageInputBuffer(
  sourceBuffer: Buffer,
  mimeType: string,
  filename: string,
  quality = 0.92,
): Promise<Buffer> {
  if (!isHeicFile(mimeType, filename)) {
    return sourceBuffer;
  }

  return convertHeicToJpegBuffer(sourceBuffer, quality);
}

export async function renderBrowserSafeImageBuffer(sourceBuffer: Buffer, mimeType: string, filename: string) {
  if (!isHeicFile(mimeType, filename)) {
    return { body: sourceBuffer, contentType: mimeType || 'application/octet-stream' };
  }

  try {
    const decoded = await convertHeicToJpegBuffer(sourceBuffer, 0.94);
    const body = await sharp(decoded, { failOn: 'none' })
      .rotate()
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    return { body, contentType: 'image/jpeg' };
  } catch {
    return { body: sourceBuffer, contentType: mimeType || 'application/octet-stream' };
  }
}
