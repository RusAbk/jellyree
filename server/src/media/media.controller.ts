import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestWithUser } from '../auth/jwt-auth.guard';
import { diskStorage } from 'multer';
import { extname, join, resolve } from 'path';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { readFile, stat, unlink, writeFile } from 'fs/promises';
import * as bcrypt from 'bcrypt';
import sharp from 'sharp';
import { Prisma, ShareAccessMode, ShareResourceType } from '@prisma/client';
import exifr from 'exifr';
import JSZip from 'jszip';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createOpaqueShareToken } from './share-token';
import { normalizeEditorAdjustments, type NormalizedEditorAdjustments } from './editor-adjustments';
import {
  getVideoUploadSessionStore,
  type VideoUploadSessionData,
} from './video-upload-session-store';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

async function extractVideoFrameFromPath(videoPath: string): Promise<Buffer> {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const tmpOut = join(tmpdir(), `jry_frame_${randomUUID()}.png`);
  try {
    try {
      await execFileAsync(ffmpegPath, ['-ss', '00:00:01', '-i', videoPath, '-frames:v', '1', '-f', 'image2', '-y', tmpOut], { timeout: 30000 });
    } catch {
      // retry without seek (short video or seek-past-end)
      await execFileAsync(ffmpegPath, ['-i', videoPath, '-frames:v', '1', '-f', 'image2', '-y', tmpOut], { timeout: 30000 });
    }
    return await readFile(tmpOut);
  } finally {
    await unlink(tmpOut).catch(() => {});
  }
}

/**
 * Extract a single JPEG frame from a video at an exact timestamp (seconds).
 * Uses fast input-seek for speed; output is full-resolution JPEG (q:v 2 = highest quality).
 */
async function extractVideoFrameAtTimestamp(videoPath: string, timestamp: number): Promise<Buffer> {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const tmpOut = join(tmpdir(), `jry_shot_${randomUUID()}.jpg`);
  const ss = Math.max(0, timestamp).toFixed(3);
  try {
    await execFileAsync(
      ffmpegPath,
      ['-ss', ss, '-i', videoPath, '-frames:v', '1', '-q:v', '2', '-f', 'image2', '-y', tmpOut],
      { timeout: 60000 },
    );
    return await readFile(tmpOut);
  } finally {
    await unlink(tmpOut).catch(() => {});
  }
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', 'wmv', '3gp', 'flv', 'ts', 'mts']);

function isVideoFile(mimeType: string, filename: string): boolean {
  if (mimeType.startsWith('video/')) return true;
  const ext = extname(filename).replace(/^\./, '').toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) return [] as R[];

  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () => runWorker()),
  );

  return results;
}

function normalizeExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const exifLike = text.match(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/,
  );

  if (exifLike) {
    const [, year, month, day, hour, minute, second, milliseconds] = exifLike;
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds || '000'}Z`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const exifWithOffset = text.match(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:\s?([+-]\d{2}:?\d{2}|Z))$/,
  );
  if (exifWithOffset) {
    const [, year, month, day, hour, minute, second, milliseconds, offsetRaw] = exifWithOffset;
    const offset = offsetRaw === 'Z' ? 'Z' : offsetRaw.includes(':') ? offsetRaw : `${offsetRaw.slice(0, 3)}:${offsetRaw.slice(3)}`;
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds || '000'}${offset}`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const exifShort = text.match(/^(\d{4}):(\d{2}):(\d{2})$/);
  if (exifShort) {
    const [, year, month, day] = exifShort;
    const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function pickMetadataDate(meta: Record<string, unknown> | null, keys: string[]) {
  if (!meta) return null;
  for (const key of keys) {
    const parsed = normalizeExifDate(meta[key]);
    if (parsed) return parsed;
  }

  for (const [key, value] of Object.entries(meta)) {
    if (!/(date|time)/i.test(key)) continue;
    const parsed = normalizeExifDate(value);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeCoordinate(value: unknown): number | null {
  if (Array.isArray(value) && value.length > 0) {
    const [degreesRaw, minutesRaw, secondsRaw] = value;
    const degrees = Number(degreesRaw);
    if (!Number.isFinite(degrees)) return null;
    const minutes = Number(minutesRaw || 0);
    const seconds = Number(secondsRaw || 0);
    return degrees + minutes / 60 + seconds / 3600;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

type UploadMetadata = {
  width: number | null;
  height: number | null;
  capturedAt: Date | null;
  metadataCreatedAt: Date | null;
  metadataModifiedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
};

type LiquifyStrokePayload = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  radius: number;
  strength: number;
};

type StretchPayload = {
  axis: 'vertical' | 'horizontal';
  start: number;
  end: number;
  amount: number;
};

type EditorDeformationPayload = {
  liquifyStrokes?: LiquifyStrokePayload[];
  stretch?: StretchPayload;
};

type NormalizedEditorDeformation = {
  liquifyStrokes: LiquifyStrokePayload[];
  stretch: StretchPayload | null;
};

function normalizeEditorDeformation(
  input: unknown,
): NormalizedEditorDeformation | null {
  if (!input || typeof input !== 'object') return null;

  const source = input as Record<string, unknown>;
  const rawStrokes = Array.isArray(source.liquifyStrokes) ? source.liquifyStrokes : [];

  const liquifyStrokes: LiquifyStrokePayload[] = rawStrokes
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      return {
        fromX: clamp(toNumber(row.fromX, 0), 0, 1),
        fromY: clamp(toNumber(row.fromY, 0), 0, 1),
        toX: clamp(toNumber(row.toX, 0), 0, 1),
        toY: clamp(toNumber(row.toY, 0), 0, 1),
        radius: clamp(toNumber(row.radius, 0), 0.01, 0.55),
        strength: clamp(toNumber(row.strength, 0), 0.01, 1.4),
      };
    })
    .filter((value): value is LiquifyStrokePayload => Boolean(value))
    .slice(0, 240);

  let stretch: StretchPayload | null = null;
  if (source.stretch && typeof source.stretch === 'object') {
    const row = source.stretch as Record<string, unknown>;
    const axis = row.axis === 'horizontal' ? 'horizontal' : 'vertical';
    const start = clamp(toNumber(row.start, 0), 0, 100);
    const end = clamp(toNumber(row.end, 100), 0, 100);
    const amount = clamp(toNumber(row.amount, 0), -85, 85);
    const safeStart = Math.min(start, end);
    const safeEnd = Math.max(start, end);
    stretch = {
      axis,
      start: safeStart,
      end: Math.max(safeStart + 8, safeEnd),
      amount,
    };
  }

  if (liquifyStrokes.length === 0 && (!stretch || Math.abs(stretch.amount) < 0.01)) {
    return null;
  }

  return {
    liquifyStrokes,
    stretch,
  };
}

function ensureDir(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

const candidateA = resolve(__dirname, '..', '..', '..');
const candidateB = resolve(__dirname, '..', '..', '..', '..');
const serverRoot = existsSync(resolve(candidateA, 'prisma')) ? candidateA : candidateB;
const tempUploadRoot = resolve(serverRoot, 'uploads');
ensureDir(tempUploadRoot);

const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2BucketName = process.env.R2_BUCKET_NAME || '';
const uploadProcessingConcurrency = clampInteger(
  toNumber(process.env.UPLOAD_PROCESSING_CONCURRENCY, 3),
  2,
  4,
);
const videoChunkSizeBytes = clampInteger(
  toNumber(process.env.VIDEO_UPLOAD_CHUNK_BYTES, 8 * 1024 * 1024),
  1 * 1024 * 1024,
  16 * 1024 * 1024,
);
const r2Endpoint =
  process.env.R2_ENDPOINT ||
  (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');

type VideoUploadSession = {
  uploadId: string;
  ownerId: string;
  tempFileName: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  relativePath: string | null;
  lastModifiedAtIso: string | null;
  albumId: string | null;
  createAlbumsFromFolders: boolean;
  createdAt: number;
  uploadedBytes: number;
};
const videoUploadSessionStore = getVideoUploadSessionStore();

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private r2Client: S3Client | null = null;

  private getR2Client() {
    if (this.r2Client) return this.r2Client;

    if (!r2AccessKeyId || !r2SecretAccessKey || !r2BucketName || !r2Endpoint) {
      throw new BadRequestException('R2 storage is not configured');
    }

    this.r2Client = new S3Client({
      region: 'auto',
      endpoint: r2Endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });

    return this.r2Client;
  }

  private objectKey(ownerId: string, relativePath: string) {
    const cleanedPath = relativePath.replace(/^\/+/, '');
    if (cleanedPath.startsWith(`${ownerId}/`)) {
      return cleanedPath;
    }
    return `${ownerId}/${cleanedPath}`;
  }

  private async readBodyToBuffer(body: unknown) {
    if (!body) return Buffer.alloc(0);

    if (Buffer.isBuffer(body)) return body;

    if (typeof body === 'string') {
      return Buffer.from(body);
    }

    const bodyWithTransform = body as { transformToByteArray?: () => Promise<Uint8Array> };
    if (typeof bodyWithTransform.transformToByteArray === 'function') {
      const bytes = await bodyWithTransform.transformToByteArray();
      return Buffer.from(bytes);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string | Buffer>) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }

    return Buffer.concat(chunks);
  }

  private async uploadLocalFileToR2(
    ownerId: string,
    relativePath: string,
    mimeType: string,
    absolutePath: string,
  ) {
    const client = this.getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: r2BucketName,
        Key: this.objectKey(ownerId, relativePath),
        Body: createReadStream(absolutePath),
        ContentType: mimeType || undefined,
      }),
    );
  }

  private async uploadBufferToR2(ownerId: string, relativePath: string, mimeType: string, body: Buffer) {
    const client = this.getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: r2BucketName,
        Key: this.objectKey(ownerId, relativePath),
        Body: body,
        ContentType: mimeType || undefined,
      }),
    );
  }

  private async getObjectFromR2(ownerId: string, relativePath: string) {
    const client = this.getR2Client();
    const key = this.objectKey(ownerId, relativePath);
    const legacyKey = relativePath.replace(/^\/+/, '');
    try {
      return await client.send(
        new GetObjectCommand({
          Bucket: r2BucketName,
          Key: key,
        }),
      );
    } catch (error) {
      const code = (error as { Code?: string; name?: string } | undefined)?.Code
        || (error as { Code?: string; name?: string } | undefined)?.name;
      if ((code === 'NoSuchKey' || code === 'NotFound') && legacyKey && legacyKey !== key) {
        try {
          return await client.send(
            new GetObjectCommand({
              Bucket: r2BucketName,
              Key: legacyKey,
            }),
          );
        } catch (legacyError) {
          const legacyCode = (legacyError as { Code?: string; name?: string } | undefined)?.Code
            || (legacyError as { Code?: string; name?: string } | undefined)?.name;
          if (legacyCode === 'NoSuchKey' || legacyCode === 'NotFound') {
            throw new NotFoundException(`Stored file not found in R2: ${relativePath}`);
          }
          throw legacyError;
        }
      }
      if (code === 'NoSuchKey' || code === 'NotFound') {
        throw new NotFoundException(`Stored file not found in R2: ${relativePath}`);
      }
      throw error;
    }
  }

  private async getObjectBufferFromR2(ownerId: string, relativePath: string) {
    const object = await this.getObjectFromR2(ownerId, relativePath);
    if (!object.Body) {
      throw new BadRequestException('Stored file is empty');
    }
    return this.readBodyToBuffer(object.Body);
  }

  private async deleteObjectFromR2(ownerId: string, relativePath: string) {
    const client = this.getR2Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: r2BucketName,
        Key: this.objectKey(ownerId, relativePath),
      }),
    );
  }

  // Stream an R2 object directly to a local file (no in-memory buffer — safe for large files)
  private async streamR2ObjectToFile(ownerId: string, relativePath: string, destPath: string): Promise<void> {
    const object = await this.getObjectFromR2(ownerId, relativePath);
    if (!object.Body) throw new BadRequestException('Stored file is empty');
    const ws = createWriteStream(destPath);
    const body = object.Body as AsyncIterable<Uint8Array | Buffer>;
    try {
      for await (const chunk of body) {
        const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
        const canContinue = ws.write(buf);
        if (!canContinue) {
          await new Promise<void>((res) => ws.once('drain', res));
        }
      }
    } finally {
      await new Promise<void>((res, rej) => {
        ws.end();
        ws.on('finish', res);
        ws.on('error', rej);
      });
    }
  }

  private async warmThumbCacheAsync(
    ownerId: string,
    mediaId: string,
    filePath: string,
    mimeType: string,
    updatedAt: Date,
    thumbWidth = 640,
  ): Promise<void> {
    try {
      const thumbPath = `thumbs/${mediaId}_${updatedAt.getTime()}_${thumbWidth}.webp`;
      let sourceBuffer: Buffer;
      if (isVideoFile(mimeType, filePath)) {
        // Stream video to a temp file — never load full video into RAM (OOM risk for large files)
        const tmpVidPath = join(tmpdir(), `jry_warm_${randomUUID()}${extname(filePath) || '.mp4'}`);
        try {
          await this.streamR2ObjectToFile(ownerId, filePath, tmpVidPath);
          sourceBuffer = await extractVideoFrameFromPath(tmpVidPath);
        } finally {
          await unlink(tmpVidPath).catch(() => {});
        }
      } else {
        sourceBuffer = await this.getObjectBufferFromR2(ownerId, filePath);
      }
      const thumbBuffer = await sharp(sourceBuffer, { failOn: 'none' })
        .rotate()
        .resize({ width: thumbWidth, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
      await this.uploadBufferToR2(ownerId, thumbPath, 'image/webp', thumbBuffer);
    } catch (err) {
      // best-effort: thumb will be generated on first request if this fails
      console.error(`[warmThumb] failed for media ${mediaId}:`, err instanceof Error ? err.message : err);
    }
  }

  private async ensureCanCreateFiles(ownerId: string, fileCountDelta: number, sizeDeltaBytes: number) {
    if (fileCountDelta <= 0 && sizeDeltaBytes <= 0) return;

    const [user, usage] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: ownerId },
        select: {
          id: true,
          maxFileCount: true,
          maxTotalSizeBytes: true,
        },
      }),
      this.prisma.media.aggregate({
        where: { ownerId },
        _count: { id: true },
        _sum: { sizeBytes: true },
      }),
    ]);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const currentFileCount = Number(usage._count.id ?? 0);
    const currentSizeBytes = Number(usage._sum.sizeBytes ?? 0);

    if (user.maxFileCount != null && currentFileCount + fileCountDelta > user.maxFileCount) {
      throw new BadRequestException(
        `File count limit reached (${user.maxFileCount}). Delete files or set unlimited in admin panel.`,
      );
    }

    if (
      user.maxTotalSizeBytes != null &&
      currentSizeBytes + Math.max(0, sizeDeltaBytes) > user.maxTotalSizeBytes
    ) {
      throw new BadRequestException(
        `Storage limit reached (${user.maxTotalSizeBytes} bytes). Free space or set unlimited in admin panel.`,
      );
    }
  }

  private async ensureCanCreateAlbums(ownerId: string, albumCountDelta: number) {
    if (albumCountDelta <= 0) return;

    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, maxAlbumCount: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.maxAlbumCount == null) return;

    const currentAlbumCount = await this.prisma.album.count({ where: { ownerId } });
    if (currentAlbumCount + albumCountDelta > user.maxAlbumCount) {
      throw new BadRequestException(
        `Album limit reached (${user.maxAlbumCount}). Delete albums or set unlimited in admin panel.`,
      );
    }
  }

  private async ensureAdminAccess(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isAdmin: true },
    });

    if (!user || !user.isAdmin) {
      throw new BadRequestException('Admin access required');
    }
  }

  private normalizeDownloadFileName(name: string) {
    const fallback = 'file';
    const sanitized = name
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 180);
    return sanitized || fallback;
  }

  private buildContentDisposition(filename: string) {
    const normalized = this.normalizeDownloadFileName(filename).replace(/"/g, '_');
    const encoded = encodeURIComponent(normalized);
    return `attachment; filename="${normalized}"; filename*=UTF-8''${encoded}`;
  }

  private buildJpegFilename(filename: string) {
    const trimmed = filename.trim();
    const dotIndex = trimmed.lastIndexOf('.');
    if (dotIndex <= 0) {
      return `${trimmed || 'photo'}.jpg`;
    }
    const stem = trimmed.slice(0, dotIndex);
    return `${stem}.jpg`;
  }

  private async readUploadMetadata(fileName: string, mimeType: string): Promise<UploadMetadata> {
    const defaults: UploadMetadata = {
      width: null,
      height: null,
      capturedAt: null,
      metadataCreatedAt: null,
      metadataModifiedAt: null,
      latitude: null,
      longitude: null,
    };

    const filePath = resolve(tempUploadRoot, fileName);

    try {
      const imageMeta = await sharp(filePath, { failOn: 'none' }).metadata();

      const baseMeta: UploadMetadata = {
        ...defaults,
        width: imageMeta.width || null,
        height: imageMeta.height || null,
      };

      let exifMeta: Record<string, unknown> | null = null;

      try {
        exifMeta = (await exifr.parse(filePath)) as Record<string, unknown> | null;
      } catch {
        exifMeta = null;
      }

      const capturedAt = pickMetadataDate(exifMeta, [
        'DateTimeOriginal',
        'SubSecDateTimeOriginal',
        'DateTimeDigitized',
        'CreateDate',
        'DateCreated',
        'CreationDate',
        'ContentCreateDate',
        'DateTime',
        'Date/Time Original',
      ]);

      const metadataCreatedAt = pickMetadataDate(exifMeta, [
        'CreateDate',
        'DateTimeOriginal',
        'DateTimeDigitized',
        'DateCreated',
        'CreationDate',
        'ContentCreateDate',
      ]);

      const metadataModifiedAt =
        pickMetadataDate(exifMeta, [
          'ModifyDate',
          'FileModifyDate',
          'MetadataDate',
          'LastModified',
          'ContentModifyDate',
          'DateTime',
        ]) || metadataCreatedAt;

      const latitude = normalizeCoordinate(exifMeta?.latitude ?? exifMeta?.GPSLatitude);
      const longitude = normalizeCoordinate(exifMeta?.longitude ?? exifMeta?.GPSLongitude);

      return {
        ...baseMeta,
        capturedAt,
        metadataCreatedAt,
        metadataModifiedAt,
        latitude,
        longitude,
      };
    } catch {
      return defaults;
    }
  }

  private async resolveAlbumForRelativePath(
    ownerId: string,
    relativePath: string | null,
    baseAlbumId: string | null,
  ) {
    if (!relativePath) {
      return baseAlbumId;
    }

    const pathParts = relativePath
      .split(/[\\/]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && part !== '.' && part !== '..');

    const folderParts = pathParts.length > 1 ? pathParts.slice(0, -1) : [];
    if (folderParts.length === 0) {
      return baseAlbumId;
    }

    let targetAlbumId: string | null = baseAlbumId;
    for (const folderName of folderParts) {
      const normalizedName = folderName.trim() || 'Untitled album';

      const existing = await this.prisma.album.findFirst({
        where: {
          ownerId,
          parentId: targetAlbumId,
          name: normalizedName,
        },
        select: { id: true },
      });

      if (existing) {
        targetAlbumId = existing.id;
        continue;
      }

      await this.ensureCanCreateAlbums(ownerId, 1);
      const createdAlbum = await this.prisma.album.create({
        data: {
          ownerId,
          parentId: targetAlbumId,
          name: normalizedName,
        },
        select: { id: true },
      });
      targetAlbumId = createdAlbum.id;
    }

    return targetAlbumId;
  }

  private async getLocalFileSize(filePath: string) {
    try {
      const file = await stat(filePath);
      return Number(file.size || 0);
    } catch {
      return 0;
    }
  }

  private async pipeRequestBodyToLocalFile(req: RequestWithUser, absolutePath: string) {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const output = createWriteStream(absolutePath, { flags: 'a' });

      output.on('error', rejectPromise);
      req.on('aborted', () => rejectPromise(new BadRequestException('Upload aborted by client')));
      req.on('error', rejectPromise);

      output.on('finish', () => resolvePromise());
      req.pipe(output);
    });
  }

  private async clearMediaRevisions(mediaId: string, ownerId: string) {
    const revisions = await this.prisma.mediaRevision.findMany({
      where: { mediaId },
      select: { filePath: true },
    });

    if (revisions.length === 0) return;

    await this.prisma.mediaRevision.deleteMany({ where: { mediaId } });

    await Promise.all(
      revisions.map((entry) =>
        this.deleteObjectFromR2(ownerId, entry.filePath).catch(() => {
          return;
        }),
      ),
    );
  }

  private clampPixel(value: number, max: number) {
    return value < 0 ? 0 : value > max ? max : value;
  }

  private sampleBilinear(
    source: Uint8ClampedArray<ArrayBufferLike>,
    width: number,
    height: number,
    channels: number,
    x: number,
    y: number,
  ) {
    const x0 = this.clampPixel(Math.floor(x), width - 1);
    const y0 = this.clampPixel(Math.floor(y), height - 1);
    const x1 = this.clampPixel(x0 + 1, width - 1);
    const y1 = this.clampPixel(y0 + 1, height - 1);
    const tx = clamp(x - x0, 0, 1);
    const ty = clamp(y - y0, 0, 1);

    const i00 = (y0 * width + x0) * channels;
    const i10 = (y0 * width + x1) * channels;
    const i01 = (y1 * width + x0) * channels;
    const i11 = (y1 * width + x1) * channels;

    const sample = new Array<number>(channels).fill(0);
    for (let c = 0; c < channels; c += 1) {
      const top = (source[i00 + c] ?? 0) * (1 - tx) + (source[i10 + c] ?? 0) * tx;
      const bottom = (source[i01 + c] ?? 0) * (1 - tx) + (source[i11 + c] ?? 0) * tx;
      sample[c] = top * (1 - ty) + bottom * ty;
    }
    return sample;
  }

  private applyLiquifyPixels(
    source: Uint8ClampedArray<ArrayBufferLike>,
    width: number,
    height: number,
    channels: number,
    strokes: LiquifyStrokePayload[],
  ): Uint8ClampedArray<ArrayBufferLike> {
    if (strokes.length === 0) return source;

    const minSide = Math.max(1, Math.min(width, height));
    const displacementX = new Float32Array(width * height);
    const displacementY = new Float32Array(width * height);

    for (const stroke of strokes) {
      const radiusPx = Math.max(1, stroke.radius * minSide);
      const fromX = stroke.fromX * width;
      const fromY = stroke.fromY * height;
      const dx = (stroke.toX - stroke.fromX) * width * stroke.strength * 0.92;
      const dy = (stroke.toY - stroke.fromY) * height * stroke.strength * 0.92;

      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue;

      const x0 = Math.max(0, Math.floor(fromX - radiusPx));
      const y0 = Math.max(0, Math.floor(fromY - radiusPx));
      const x1 = Math.min(width - 1, Math.ceil(fromX + radiusPx));
      const y1 = Math.min(height - 1, Math.ceil(fromY + radiusPx));

      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const vx = x - fromX;
          const vy = y - fromY;
          const dist = Math.sqrt(vx * vx + vy * vy);
          if (dist > radiusPx) continue;

          const t = 1 - dist / radiusPx;
          const falloff = t * t * (2 - t);
          const index = y * width + x;
          displacementX[index] = (displacementX[index] ?? 0) + dx * falloff;
          displacementY[index] = (displacementY[index] ?? 0) + dy * falloff;
        }
      }
    }

    const target = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const srcX = this.clampPixel(x - (displacementX[index] ?? 0), width - 1);
        const srcY = this.clampPixel(y - (displacementY[index] ?? 0), height - 1);
        const sample = this.sampleBilinear(source, width, height, channels, srcX, srcY);
        const pixel = index * channels;
        for (let c = 0; c < channels; c += 1) {
          target[pixel + c] = clampInteger(sample[c] ?? 0, 0, 255);
        }
      }
    }

    return target;
  }

  private applyStretchPixels(
    source: Uint8ClampedArray<ArrayBufferLike>,
    width: number,
    height: number,
    channels: number,
    stretch: StretchPayload,
  ): { data: Uint8ClampedArray<ArrayBufferLike>; width: number; height: number } {
    if (Math.abs(stretch.amount) <= 0.01) {
      return { data: source, width, height };
    }

    const axisLength = stretch.axis === 'vertical' ? width : height;
    const inputStart = clampInteger((stretch.start / 100) * axisLength, 0, axisLength - 1);
    const inputEnd = clampInteger((stretch.end / 100) * axisLength, 1, axisLength);
    const baseBandSize = Math.max(1, inputEnd - inputStart);
    const scale = clamp(1 + stretch.amount / 100, 0.15, 2.8);
    const outputBandSize = Math.max(1, Math.round(baseBandSize * scale));
    const delta = outputBandSize - baseBandSize;

    const targetWidth = stretch.axis === 'vertical' ? Math.max(2, width + delta) : width;
    const targetHeight = stretch.axis === 'horizontal' ? Math.max(2, height + delta) : height;
    const target = new Uint8ClampedArray(targetWidth * targetHeight * channels);

    if (stretch.axis === 'vertical') {
      const destStart = inputStart;
      const destEnd = destStart + outputBandSize;

      for (let y = 0; y < targetHeight; y += 1) {
        for (let x = 0; x < targetWidth; x += 1) {
          let srcX = x;
          if (x >= destStart && x < destEnd) {
            const t = (x - destStart) / Math.max(1, outputBandSize);
            srcX = inputStart + t * baseBandSize;
          } else if (x >= destEnd) {
            srcX = x - delta;
          }

          const sample = this.sampleBilinear(
            source,
            width,
            height,
            channels,
            this.clampPixel(srcX, width - 1),
            y,
          );
          const pixel = (y * targetWidth + x) * channels;
          for (let c = 0; c < channels; c += 1) {
            target[pixel + c] = clampInteger(sample[c] ?? 0, 0, 255);
          }
        }
      }
    } else {
      const destStart = inputStart;
      const destEnd = destStart + outputBandSize;

      for (let y = 0; y < targetHeight; y += 1) {
        for (let x = 0; x < targetWidth; x += 1) {
          let srcY = y;
          if (y >= destStart && y < destEnd) {
            const t = (y - destStart) / Math.max(1, outputBandSize);
            srcY = inputStart + t * baseBandSize;
          } else if (y >= destEnd) {
            srcY = y - delta;
          }

          const sample = this.sampleBilinear(
            source,
            width,
            height,
            channels,
            x,
            this.clampPixel(srcY, height - 1),
          );
          const pixel = (y * targetWidth + x) * channels;
          for (let c = 0; c < channels; c += 1) {
            target[pixel + c] = clampInteger(sample[c] ?? 0, 0, 255);
          }
        }
      }
    }

    return { data: target, width: targetWidth, height: targetHeight };
  }

  private async applyDeformationBuffer(
    sourceBuffer: Buffer,
    deformation: NormalizedEditorDeformation | null,
  ) {
    if (!deformation) return sourceBuffer;

    const base = sharp(sourceBuffer, { failOn: 'none' }).ensureAlpha();
    const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
    let width = info.width;
    let height = info.height;
    const channels = info.channels;

    let working: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(data);

    if (deformation.liquifyStrokes.length > 0) {
      working = this.applyLiquifyPixels(
        working,
        width,
        height,
        channels,
        deformation.liquifyStrokes,
      );
    }

    if (deformation.stretch && Math.abs(deformation.stretch.amount) > 0.01) {
      const stretched = this.applyStretchPixels(
        working,
        width,
        height,
        channels,
        deformation.stretch,
      );
      working = stretched.data;
      width = stretched.width;
      height = stretched.height;
    }

    const inputMeta = await sharp(sourceBuffer, { failOn: 'none' }).metadata();
    let output = sharp(Buffer.from(working), {
      raw: {
        width,
        height,
        channels,
      },
    });

    if (inputMeta.format === 'png') {
      return output.png().toBuffer();
    }

    if (inputMeta.format === 'webp') {
      return output.webp({ quality: 92 }).toBuffer();
    }

    if (inputMeta.format === 'avif') {
      return output.avif({ quality: 56 }).toBuffer();
    }

    return output.jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
  }

  private async renderEditedImageBuffer(
    sourceBuffer: Buffer,
    adjustments: NormalizedEditorAdjustments,
    options?: { preview?: boolean; deformation?: NormalizedEditorDeformation | null },
  ) {
    const {
      temperature,
      brightness,
      contrast,
      saturation,
      toneDepth,
      shadowsLevel,
      highlightsLevel,
      sharpness,
      definition,
      vignette,
      glamour,
      grayscale,
      sepia,
      exposure,
      tint,
      vibrance,
      clarity,
      grain,
      fade,
      cropZoom,
      rotate,
      flipX,
      flipY,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
    } = adjustments;

    const source = sharp(sourceBuffer, { failOn: 'none' });
    const metadata = await source.metadata();

    if (!metadata.width || !metadata.height) {
      throw new BadRequestException('Cannot read image dimensions');
    }

    let pipeline = source;

    const initialLeft = Math.round((cropX / 100) * metadata.width);
    const initialTop = Math.round((cropY / 100) * metadata.height);
    const initialWidth = Math.max(1, Math.round((cropWidth / 100) * metadata.width));
    const initialHeight = Math.max(1, Math.round((cropHeight / 100) * metadata.height));
    const boundedWidth = Math.min(initialWidth, metadata.width - initialLeft);
    const boundedHeight = Math.min(initialHeight, metadata.height - initialTop);

    if (
      boundedWidth < metadata.width ||
      boundedHeight < metadata.height ||
      initialLeft > 0 ||
      initialTop > 0
    ) {
      pipeline = pipeline.extract({
        left: initialLeft,
        top: initialTop,
        width: boundedWidth,
        height: boundedHeight,
      });
    }

    if (cropZoom > 0) {
      const currentWidth = boundedWidth;
      const currentHeight = boundedHeight;
      const zoomFactor = 1 + cropZoom / 100;
      const zoomedWidth = Math.max(1, Math.round(currentWidth / zoomFactor));
      const zoomedHeight = Math.max(1, Math.round(currentHeight / zoomFactor));
      const left = Math.max(0, Math.round((currentWidth - zoomedWidth) / 2));
      const top = Math.max(0, Math.round((currentHeight - zoomedHeight) / 2));
      pipeline = pipeline.extract({ left, top, width: zoomedWidth, height: zoomedHeight });
    }

    if (rotate) {
      pipeline = pipeline.rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    if (flipX) {
      pipeline = pipeline.flop();
    }

    if (flipY) {
      pipeline = pipeline.flip();
    }

    // Exposure (EV-based multiplicative, ±2 stops)
    if (exposure !== 0) {
      const expFactor = Math.max(0.05, Math.pow(2, (exposure / 100) * 2));
      pipeline = pipeline.linear(expFactor, 0);
    }

    const brightnessFactor = Math.max(0, 1 + brightness / 100);
    const saturationFactor = Math.max(0, (1 + saturation / 100) * (1 - grayscale / 100));

    pipeline = pipeline.modulate({
      brightness: brightnessFactor,
      saturation: saturationFactor,
    });

    // Vibrance (approximate: smaller saturation scale than full saturation)
    if (vibrance !== 0) {
      const vibFactor = Math.max(0, 1 + vibrance / 240);
      pipeline = pipeline.modulate({ saturation: vibFactor });
    }

    if (temperature !== 0) {
      const warmFactor = temperature / 100;
      const redGain = clamp(1 + warmFactor * 0.38, 0.6, 1.5);
      const greenGain = clamp(1 + warmFactor * 0.08, 0.75, 1.3);
      const blueGain = clamp(1 - warmFactor * 0.34, 0.55, 1.5);
      pipeline = pipeline.linear([redGain, greenGain, blueGain]);
    }

    // Tint (green-magenta white balance axis)
    if (tint !== 0) {
      const greenGain = clamp(1 - (tint / 100) * 0.15, 0.72, 1.28);
      pipeline = pipeline.linear([1, greenGain, 1]);
    }

    if (contrast !== 0) {
      const contrastFactor = Math.max(0.05, 1 + contrast / 100);
      const offset = 128 - 128 * contrastFactor;
      pipeline = pipeline.linear(contrastFactor, offset);
    }

    if (toneDepth !== 0) {
      const toneContrast = Math.max(0.1, 1 + toneDepth / 230);
      const toneOffset = 128 - 128 * toneContrast;
      pipeline = pipeline.linear(toneContrast, toneOffset);
    }

    if (shadowsLevel !== 0 || highlightsLevel !== 0) {
      const tonalSlope = clamp(1 - highlightsLevel / 260, 0.6, 1.5);
      const tonalOffset = shadowsLevel / 1.6;
      pipeline = pipeline.linear(tonalSlope, tonalOffset);
    }

    if (definition !== 0) {
      const definitionContrast = Math.max(0.1, 1 + definition / 280);
      const definitionOffset = 128 - 128 * definitionContrast;
      pipeline = pipeline.linear(definitionContrast, definitionOffset);
    }

    if (sharpness > 0 || definition > 0) {
      const sharpenSigma = clamp(0.4 + sharpness / 55 + Math.max(0, definition) / 120, 0.4, 4.5);
      pipeline = pipeline.sharpen(sharpenSigma);
    }

    // Clarity (midtone local contrast — positive: wide-radius sharpen; negative: soft blur)
    if (clarity !== 0) {
      if (clarity > 0) {
        pipeline = pipeline.sharpen({ sigma: clamp(1.2 + clarity / 60, 1.2, 3.5), m1: 0, m2: clarity / 50 });
      } else {
        pipeline = pipeline.blur(clamp(-clarity / 100 * 0.5 + 0.3, 0.3, 0.8));
      }
    }

    if (glamour > 0) {
      const glamourBlur = clamp(0.3 + glamour / 65, 0.3, 2.2);
      pipeline = pipeline.blur(glamourBlur).modulate({
        brightness: 1 + glamour / 850,
        saturation: 1 + glamour / 1100,
      });
    }

    if (sepia > 0) {
      pipeline = pipeline.recomb([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131],
      ]);
    }

    // Fade: lift blacks / matte film look
    if (fade > 0) {
      pipeline = pipeline.linear(1, Math.round(fade / 100 * 28));
    }

    if (options?.preview) {
      pipeline = pipeline.resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
        fastShrinkOnLoad: true,
      });
    }

    let outputBuffer = await pipeline.toBuffer();

    // Film grain via SVG feTurbulence overlay
    if (grain > 0) {
      const grainMeta = await sharp(outputBuffer, { failOn: 'none' }).metadata();
      if (grainMeta.width && grainMeta.height) {
        const grainOpacity = clamp(grain / 100 * 0.52, 0.04, 0.52);
        const baseFreq = clamp(0.55 + grain / 100 * 0.35, 0.55, 0.90).toFixed(3);
        const grainSvg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${grainMeta.width}" height="${grainMeta.height}">` +
          `<filter id="g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
          `<feTurbulence type="fractalNoise" baseFrequency="${baseFreq}" numOctaves="1" stitchTiles="stitch"/>` +
          `<feColorMatrix type="saturate" values="0"/>` +
          `</filter>` +
          `<rect width="100%" height="100%" filter="url(#g)" opacity="${grainOpacity}"/>` +
          `</svg>`,
        );
        outputBuffer = await sharp(outputBuffer, { failOn: 'none' })
          .composite([{ input: grainSvg, blend: 'overlay' }])
          .toBuffer();
      }
    }

    if (vignette > 0) {
      const outputSize = await sharp(outputBuffer, { failOn: 'none' }).metadata();
      if (outputSize.width && outputSize.height) {
        const vignetteOpacity = clamp(vignette / 170, 0, 0.58);
        const vignetteSvg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${outputSize.width}" height="${outputSize.height}">
            <defs>
              <radialGradient id="v" cx="50%" cy="50%" r="70%">
                <stop offset="58%" stop-color="white" stop-opacity="0" />
                <stop offset="100%" stop-color="black" stop-opacity="${vignetteOpacity}" />
              </radialGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#v)" />
          </svg>`,
        );

        outputBuffer = await sharp(outputBuffer)
          .composite([{ input: vignetteSvg, blend: 'multiply' }])
          .toBuffer();
      }
    }

    if (options?.deformation) {
      outputBuffer = await this.applyDeformationBuffer(outputBuffer, options.deformation);
    }

    if (options?.preview) {
      return sharp(outputBuffer, { failOn: 'none' })
        .jpeg({ quality: 72, chromaSubsampling: '4:2:0', mozjpeg: true, progressive: true })
        .toBuffer();
    }

    return outputBuffer;
  }

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('favorite') favorite?: string,
    @Query('tag') tag?: string,
    @Query('albumId') albumId?: string,
    @Query('includeNestedAlbums') includeNestedAlbums?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    const pageNumber = toNumber(page, 1);
    const pageSize = clamp(toNumber(limit, 20), 1, 100);
    const offset = Math.max(pageNumber - 1, 0) * pageSize;
    const favoriteOnly = favorite === 'true';
    const withNestedAlbums = includeNestedAlbums === 'true';

    let albumScopeIds: string[] | null = null;
    if (albumId && withNestedAlbums) {
      const ownerAlbums = await this.prisma.album.findMany({
        where: { ownerId: req.user!.id },
        select: { id: true, parentId: true },
      });

      const childrenByParent = new Map<string | null, string[]>();
      ownerAlbums.forEach((album) => {
        const key = album.parentId ?? null;
        const bucket = childrenByParent.get(key) ?? [];
        bucket.push(album.id);
        childrenByParent.set(key, bucket);
      });

      const scoped = new Set<string>();
      const queue: string[] = [albumId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (scoped.has(current)) continue;
        scoped.add(current);
        const children = childrenByParent.get(current) ?? [];
        children.forEach((childId) => queue.push(childId));
      }

      albumScopeIds = Array.from(scoped);
    }

    const where: Prisma.MediaWhereInput = {
      ownerId: req.user!.id,
      isArchived: false,
      ...(favoriteOnly ? { isFavorite: true } : {}),
      ...(q
        ? {
            OR: [
              { filename: { contains: q } },
              {
                mediaTags: {
                  some: {
                    tag: {
                      name: {
                        contains: q.toLowerCase(),
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(tag
        ? {
            mediaTags: {
              some: {
                tag: { name: tag.toLowerCase() },
              },
            },
          }
        : {}),
      ...(albumId
        ? {
            albumMedia: {
              some: {
                albumId: {
                  in: withNestedAlbums ? albumScopeIds ?? [albumId] : [albumId],
                },
              },
            },
          }
        : {}),
    };

    const normalizedSortBy = sortBy === 'name' ? 'name' : 'date';
    const normalizedSortDir = sortDir === 'asc' ? 'asc' : 'desc';

    const orderBy: Prisma.MediaOrderByWithRelationInput[] =
      normalizedSortBy === 'name'
        ? [
            { filename: normalizedSortDir },
            { createdAt: 'desc' },
            { id: 'desc' },
          ]
        : [
            { metadataCreatedAt: normalizedSortDir },
            { capturedAt: normalizedSortDir },
            { createdAt: normalizedSortDir },
            { id: normalizedSortDir },
          ];

    const [items, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        orderBy,
        skip: offset,
        take: pageSize,
        include: {
          mediaTags: {
            include: { tag: true },
          },
          albumMedia: true,
          _count: {
            select: { revisions: true },
          },
        },
      }),
      this.prisma.media.count({ where }),
    ]);

    const mapped = items.map((item) => ({
      ...item,
      revisionCount: item._count.revisions,
    }));

    return {
      items: mapped,
      page: pageNumber,
      limit: pageSize,
      total,
      hasMore: offset + mapped.length < total,
    };
  }

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 100, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, tempUploadRoot);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async upload(
    @Req() req: RequestWithUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      relativePaths?: string;
      fileLastModifieds?: string;
      albumId?: string;
      createAlbumsFromFolders?: string | boolean;
    },
  ) {
    let relativePaths: string[] = [];
    let fileLastModifieds: Array<number | string | null> = [];

    if (body.relativePaths) {
      try {
        const parsed = JSON.parse(body.relativePaths);
        if (Array.isArray(parsed)) {
          relativePaths = parsed.map((item) => String(item));
        }
      } catch {
        throw new BadRequestException('Invalid relativePaths payload');
      }
    }

    if (body.fileLastModifieds) {
      try {
        const parsed = JSON.parse(body.fileLastModifieds);
        if (Array.isArray(parsed)) {
          fileLastModifieds = parsed.map((item) => {
            if (item == null) return null;
            if (typeof item === 'number' || typeof item === 'string') return item;
            return null;
          });
        }
      } catch {
        throw new BadRequestException('Invalid fileLastModifieds payload');
      }
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const createAlbumsFromFolders =
      body.createAlbumsFromFolders === true || body.createAlbumsFromFolders === 'true';

    const dedupedUploads: Array<{
      file: Express.Multer.File;
      relativePath: string;
      lastModified: number | string | null;
    }> = [];
    const seenUploads = new Set<string>();

    files.forEach((file, index) => {
      const relativePath = relativePaths[index] || '';
      const lastModified = fileLastModifieds[index] ?? null;
      const dedupKey = [
        relativePath || file.originalname,
        file.originalname,
        file.size,
        file.mimetype,
        lastModified ?? '',
      ].join('|');

      if (seenUploads.has(dedupKey)) {
        return;
      }

      seenUploads.add(dedupKey);
      dedupedUploads.push({ file, relativePath, lastModified });
    });

    files = dedupedUploads.map((item) => item.file);
    relativePaths = dedupedUploads.map((item) => item.relativePath);
    fileLastModifieds = dedupedUploads.map((item) => item.lastModified);

    if (body.albumId) {
      const album = await this.prisma.album.findFirst({
        where: { id: body.albumId, ownerId: req.user!.id },
        select: { id: true },
      });

      if (!album) {
        throw new BadRequestException('Album not found');
      }
    }

    const ownerId = req.user!.id;
    const uploadedTotalSizeBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    await this.ensureCanCreateFiles(ownerId, files.length, uploadedTotalSizeBytes);

    const uploadMetadata = await mapWithConcurrency(
      files || [],
      uploadProcessingConcurrency,
      (file) => this.readUploadMetadata(file.filename, file.mimetype),
    );

    const tempFilePaths = (files || []).map((file) => resolve(tempUploadRoot, file.filename));

    try {
      await mapWithConcurrency(
        files || [],
        uploadProcessingConcurrency,
        (file, index) =>
          this.uploadLocalFileToR2(ownerId, file.filename, file.mimetype, tempFilePaths[index]),
      );
    } catch (error) {
      await Promise.all(tempFilePaths.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }

    let created: Awaited<ReturnType<typeof this.prisma.media.create>>[] = [];

    try {
      created = await this.prisma.$transaction(async (tx) => {
        const nextCreated: Awaited<ReturnType<typeof tx.media.create>>[] = [];

        for (let index = 0; index < (files || []).length; index += 1) {
          const file = files[index];
          const extracted = uploadMetadata[index];
          const clientLastModifiedAt = normalizeExifDate(fileLastModifieds[index]);
          const capturedAt =
            extracted?.capturedAt ?? extracted?.metadataCreatedAt ?? clientLastModifiedAt ?? null;
          const metadataCreatedAt =
            extracted?.metadataCreatedAt ?? extracted?.capturedAt ?? clientLastModifiedAt ?? null;
          const metadataModifiedAt =
            extracted?.metadataModifiedAt ??
            extracted?.metadataCreatedAt ??
            extracted?.capturedAt ??
            clientLastModifiedAt ??
            null;

          const createdItem = await tx.media.create({
            data: {
              ownerId,
              filePath: file.filename,
              filename: file.originalname,
              relativePath: relativePaths[index] || null,
              mimeType: file.mimetype,
              sizeBytes: Number(file.size || 0),
              width: extracted?.width ?? null,
              height: extracted?.height ?? null,
              capturedAt,
              metadataCreatedAt,
              metadataModifiedAt,
              latitude: extracted?.latitude ?? null,
              longitude: extracted?.longitude ?? null,
            },
            include: {
              mediaTags: { include: { tag: true } },
              albumMedia: true,
            },
          });

          nextCreated.push(createdItem);
        }

        return nextCreated;
      });
    } catch (error) {
      await Promise.all(
        (files || []).map((file) => this.deleteObjectFromR2(ownerId, file.filename).catch(() => undefined)),
      );
      await Promise.all(tempFilePaths.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }

    await Promise.all(tempFilePaths.map((path) => unlink(path).catch(() => undefined)));

    // warm thumbnail cache in background (fire-and-forget)
    for (const item of created) {
      this.warmThumbCacheAsync(item.ownerId, item.id, item.filePath, item.mimeType, item.updatedAt).catch(() => {});
    }

    if (createAlbumsFromFolders && created.length > 0) {
      const albumCache = new Map<string, string>();

      const ensureAlbum = async (parentId: string | null, name: string) => {
        const normalizedName = name.trim();
        const cacheKey = `${parentId || 'root'}::${normalizedName.toLowerCase()}`;
        const cached = albumCache.get(cacheKey);
        if (cached) return cached;

        const existing = await this.prisma.album.findFirst({
          where: {
            ownerId,
            parentId,
            name: normalizedName,
          },
          select: { id: true },
        });

        if (existing) {
          albumCache.set(cacheKey, existing.id);
          return existing.id;
        }

        await this.ensureCanCreateAlbums(ownerId, 1);

        const createdAlbum = await this.prisma.album.create({
          data: {
            ownerId,
            parentId,
            name: normalizedName || 'Untitled album',
          },
          select: { id: true },
        });

        albumCache.set(cacheKey, createdAlbum.id);
        return createdAlbum.id;
      };

      for (const [index, item] of created.entries()) {
        const relativePath = relativePaths[index] || item.filename;
        const pathParts = relativePath
          .split(/[\\/]+/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0 && part !== '.' && part !== '..');

        const folderParts = pathParts.length > 1 ? pathParts.slice(0, -1) : [];
        let targetAlbumId: string | null = body.albumId || null;

        for (const folderName of folderParts) {
          targetAlbumId = await ensureAlbum(targetAlbumId, folderName);
        }

        if (targetAlbumId) {
          await this.prisma.albumMedia.upsert({
            where: { mediaId: item.id },
            update: { albumId: targetAlbumId },
            create: { albumId: targetAlbumId, mediaId: item.id },
          });
        }
      }
    } else if (body.albumId && created.length > 0) {
      await this.prisma.albumMedia.createMany({
        data: created.map((item) => ({
          albumId: body.albumId as string,
          mediaId: item.id,
        })),
      });
    }

    return { ok: true, created };
  }

  @Post('video-upload/init')
  async initVideoUpload(
    @Req() req: RequestWithUser,
    @Body()
    body: {
      filename?: string;
      mimeType?: string;
      sizeBytes?: number;
      relativePath?: string;
      fileLastModified?: number | string | null;
      albumId?: string;
      createAlbumsFromFolders?: string | boolean;
    },
  ) {
    const filename = String(body.filename || '').trim();
    const mimeType = String(body.mimeType || '').trim().toLowerCase();
    const sizeBytes = Number(body.sizeBytes || 0);

    if (!filename) {
      throw new BadRequestException('filename is required');
    }
    if (!mimeType.startsWith('video/') && !isVideoFile(mimeType, filename)) {
      throw new BadRequestException('Only video mime types are allowed for resumable upload');
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestException('sizeBytes must be a positive number');
    }

    const ownerId = req.user!.id;
    if (body.albumId) {
      const album = await this.prisma.album.findFirst({
        where: { id: body.albumId, ownerId },
        select: { id: true },
      });
      if (!album) {
        throw new BadRequestException('Album not found');
      }
    }

    await this.ensureCanCreateFiles(ownerId, 1, sizeBytes);

    const uploadId = randomUUID();
    const tempFileName = `${uploadId}.part`;
    const createAlbumsFromFolders =
      body.createAlbumsFromFolders === true || body.createAlbumsFromFolders === 'true';

    const session: VideoUploadSessionData = {
      uploadId,
      ownerId,
      tempFileName,
      filename,
      mimeType,
      sizeBytes,
      relativePath: body.relativePath ? String(body.relativePath) : null,
      lastModifiedAtIso: (() => {
        const normalizedDate = normalizeExifDate(body.fileLastModified ?? null);
        return normalizedDate ? normalizedDate.toISOString() : null;
      })(),
      albumId: body.albumId || null,
      createAlbumsFromFolders,
      createdAt: Date.now(),
      uploadedBytes: 0,
    };

    await videoUploadSessionStore.create(session);

    return {
      ok: true,
      uploadId,
      chunkSizeBytes: videoChunkSizeBytes,
      uploadedBytes: 0,
    };
  }

  @Patch('video-upload/:uploadId/chunk')
  async uploadVideoChunk(
    @Req() req: RequestWithUser,
    @Param('uploadId') uploadId: string,
    @Res() response: Response,
  ) {
    const session = (await videoUploadSessionStore.get(uploadId)) as VideoUploadSession | null;
    if (!session || session.ownerId !== req.user!.id) {
      return response.status(404).json({ error: 'Upload session not found' });
    }

    const tempPath = resolve(tempUploadRoot, session.tempFileName);
    const localFileBytes = await this.getLocalFileSize(tempPath);
    const expectedStartByte = Number(session.uploadedBytes || 0);

    if (localFileBytes !== expectedStartByte) {
      return response.status(409).json({
        error: 'Upload state mismatch. Retry upload or enable sticky sessions/shared temp storage.',
        expectedStartByte: localFileBytes,
      });
    }

    const headerStartRaw = req.headers['x-start-byte'];
    const headerStart = Number(Array.isArray(headerStartRaw) ? headerStartRaw[0] : headerStartRaw);

    if (!Number.isFinite(headerStart) || headerStart < 0) {
      return response.status(400).json({ error: 'x-start-byte header is required' });
    }

    if (headerStart !== expectedStartByte) {
      return response.status(409).json({
        error: 'Invalid chunk offset',
        expectedStartByte,
      });
    }

    try {
      await this.pipeRequestBodyToLocalFile(req, tempPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to write upload chunk';
      return response.status(500).json({ error: message });
    }

    const uploadedBytes = await this.getLocalFileSize(tempPath);
    if (uploadedBytes > session.sizeBytes) {
      await unlink(tempPath).catch(() => undefined);
      await videoUploadSessionStore.remove(uploadId);
      return response.status(400).json({ error: 'Uploaded bytes exceed declared file size' });
    }

    const casResult = await videoUploadSessionStore.compareAndSetUploadedBytes(
      uploadId,
      expectedStartByte,
      uploadedBytes,
    );

    if (!casResult.ok) {
      return response.status(casResult.reason === 'not_found' ? 404 : 409).json({
        error: casResult.reason === 'not_found' ? 'Upload session not found' : 'Invalid chunk offset',
        expectedStartByte: casResult.uploadedBytes,
      });
    }

    return response.json({
      ok: true,
      uploadedBytes: casResult.uploadedBytes,
      done: casResult.uploadedBytes >= session.sizeBytes,
    });
  }

  @Post('video-upload/:uploadId/complete')
  async completeVideoUpload(@Req() req: RequestWithUser, @Param('uploadId') uploadId: string) {
    const session = (await videoUploadSessionStore.get(uploadId)) as VideoUploadSession | null;
    if (!session || session.ownerId !== req.user!.id) {
      throw new NotFoundException('Upload session not found');
    }

    const tempPath = resolve(tempUploadRoot, session.tempFileName);
    const uploadedBytes = await this.getLocalFileSize(tempPath);
    if (uploadedBytes !== session.sizeBytes) {
      throw new BadRequestException(
        `Upload is incomplete (${uploadedBytes}/${session.sizeBytes} bytes)`
      );
    }

    const ownerId = req.user!.id;
    const finalFilePath = `${randomUUID()}${extname(session.filename)}`;

    try {
      await this.uploadLocalFileToR2(ownerId, finalFilePath, session.mimeType, tempPath);

      const created = await this.prisma.media.create({
        data: {
          ownerId,
          filePath: finalFilePath,
          filename: session.filename,
          relativePath: session.relativePath,
          mimeType: session.mimeType,
          sizeBytes: session.sizeBytes,
          width: null,
          height: null,
          capturedAt: session.lastModifiedAtIso ? new Date(session.lastModifiedAtIso) : null,
          metadataCreatedAt: session.lastModifiedAtIso ? new Date(session.lastModifiedAtIso) : null,
          metadataModifiedAt: session.lastModifiedAtIso ? new Date(session.lastModifiedAtIso) : null,
          latitude: null,
          longitude: null,
        },
        include: {
          mediaTags: { include: { tag: true } },
          albumMedia: true,
        },
      });

      let targetAlbumId = session.albumId;
      if (session.createAlbumsFromFolders) {
        targetAlbumId = await this.resolveAlbumForRelativePath(
          ownerId,
          session.relativePath,
          session.albumId,
        );
      }

      if (targetAlbumId) {
        await this.prisma.albumMedia.upsert({
          where: { mediaId: created.id },
          update: { albumId: targetAlbumId },
          create: { albumId: targetAlbumId, mediaId: created.id },
        });
      }

      await videoUploadSessionStore.remove(uploadId);

      // Extract video frame from local temp file BEFORE deletion (avoids re-downloading from R2)
      const videoFrameBuffer = await extractVideoFrameFromPath(tempPath).catch(() => null);

      await unlink(tempPath).catch(() => undefined);

      const reloaded = await this.prisma.media.findUnique({
        where: { id: created.id },
        include: {
          mediaTags: { include: { tag: true } },
          albumMedia: true,
        },
      });

      // Upload thumbnail from extracted frame (fire-and-forget: frame is already in RAM, no large file access)
      const thumbSource = reloaded ?? created;
      if (videoFrameBuffer) {
        const thumbPath = `thumbs/${thumbSource.id}_${thumbSource.updatedAt.getTime()}_640.webp`;
        sharp(videoFrameBuffer, { failOn: 'none' })
          .rotate()
          .resize({ width: 640, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80, effort: 4 })
          .toBuffer()
          .then((buf) => this.uploadBufferToR2(thumbSource.ownerId, thumbPath, 'image/webp', buf))
          .catch(() => {});
      }

      return {
        ok: true,
        created: reloaded ? [reloaded] : [created],
      };
    } catch (error) {
      await this.deleteObjectFromR2(ownerId, finalFilePath).catch(() => undefined);
      throw error;
    } finally {
      await videoUploadSessionStore.remove(uploadId);
      await unlink(tempPath).catch(() => undefined);
    }
  }

  @Get('admin/archive')
  async listArchived(@Req() req: RequestWithUser) {
    await this.ensureAdminAccess(req.user!.id);

    return this.prisma.media.findMany({
      where: { isArchived: true },
      orderBy: { archivedAt: 'desc' },
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
      take: 300,
    });
  }

  @Get('admin/archive/:id/file')
  async archivedFile(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    await this.ensureAdminAccess(req.user!.id);

    const media = await this.prisma.media.findFirst({
      where: { id, isArchived: true },
      select: { id: true, ownerId: true, filePath: true, mimeType: true },
    });

    if (!media) {
      return response.status(404).json({ error: 'Not found' });
    }

    try {
      const body = await this.getObjectBufferFromR2(media.ownerId, media.filePath);
      response.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
      response.setHeader('Content-Length', String(body.byteLength));
      return response.send(body);
    } catch {
      return response.status(404).json({ error: 'File not found in storage' });
    }
  }

  @Post('admin/backfill-thumbs')
  async backfillThumbs(
    @Req() req: RequestWithUser,
    @Query('videosOnly') videosOnly: string | undefined,
    @Res() response: Response,
  ) {
    await this.ensureAdminAccess(req.user!.id);

    const onlyVideos = videosOnly === '1' || videosOnly === 'true';

    // Fetch all matching media rows (no archived)
    const allMedia = await this.prisma.media.findMany({
      where: {
        isArchived: false,
        ...(onlyVideos ? { mimeType: { startsWith: 'video/' } } : {}),
      },
      select: {
        id: true,
        ownerId: true,
        filePath: true,
        mimeType: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const total = allMedia.length;

    // Stream JSON-lines progress to client
    response.setHeader('Content-Type', 'application/x-ndjson');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Transfer-Encoding', 'chunked');
    response.flushHeaders();

    const write = (obj: object) => {
      try {
        response.write(JSON.stringify(obj) + '\n');
      } catch {
        // client disconnected
      }
    };

    write({ total, done: 0, skipped: 0, errors: 0 });

    let done = 0;
    let skipped = 0;
    let errors = 0;
    const thumbWidth = 640;

    for (const media of allMedia) {
      try {
        const thumbPath = `thumbs/${media.id}_${media.updatedAt.getTime()}_${thumbWidth}.webp`;
        // check cache existence
        let exists = false;
        try {
          const cached = await this.getObjectFromR2(media.ownerId, thumbPath);
          exists = Boolean(cached.Body);
        } catch {
          exists = false;
        }

        if (exists) {
          skipped++;
        } else {
          let sourceBuffer: Buffer;
          if (isVideoFile(media.mimeType, media.filePath)) {
            const tmpVidPath = join(tmpdir(), `jry_backfill_${randomUUID()}${extname(media.filePath) || '.mp4'}`);
            try {
              await this.streamR2ObjectToFile(media.ownerId, media.filePath, tmpVidPath);
              sourceBuffer = await extractVideoFrameFromPath(tmpVidPath);
            } finally {
              await unlink(tmpVidPath).catch(() => {});
            }
          } else {
            sourceBuffer = await this.getObjectBufferFromR2(media.ownerId, media.filePath);
          }
          const thumbBuffer = await sharp(sourceBuffer, { failOn: 'none' })
            .rotate()
            .resize({ width: thumbWidth, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80, effort: 4 })
            .toBuffer();
          await this.uploadBufferToR2(media.ownerId, thumbPath, 'image/webp', thumbBuffer);
          done++;
        }
      } catch (err) {
        errors++;
        write({ error: String(err), mediaId: media.id });
      }

      write({ total, done, skipped, errors });
    }

    write({ finished: true, total, done, skipped, errors });
    response.end();
  }

  @Get(':id/file')
  async file(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
    });

    if (!media) {
      return response.status(404).json({ error: 'Not found' });
    }

    try {
      const object = await this.getObjectFromR2(req.user!.id, media.filePath);
      if (!object.Body) {
        return response.status(404).json({ error: 'File not found in storage' });
      }

      const body = await this.readBodyToBuffer(object.Body);
      response.setHeader('Content-Type', object.ContentType || media.mimeType || 'application/octet-stream');
      if (typeof object.ContentLength === 'number') {
        response.setHeader('Content-Length', String(object.ContentLength));
      }
      return response.send(body);
    } catch {
      return response.status(404).json({ error: 'File not found in storage' });
    }
  }

  /**
   * Streaming video endpoint — accepts JWT via ?token= query param so <video src> can use it.
   * Auth is handled by JwtAuthGuard which now accepts query-param tokens.
   * Supports HTTP Range requests for seeking.
   */
  @Get(':id/stream')
  async stream(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const userId = req.user!.id;
    const media = await this.prisma.media.findFirst({ where: { id, ownerId: userId } });
    if (!media) return response.status(404).json({ error: 'Not found' });

    const rangeHeader = (req.headers['range'] as string | undefined);
    const client = this.getR2Client();
    const key = this.objectKey(userId, media.filePath);
    const legacyKey = media.filePath.replace(/^\/+/, '');

    const tryGetObject = async (k: string) => {
      return client.send(
        new GetObjectCommand({
          Bucket: r2BucketName,
          Key: k,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        }),
      );
    };

    try {
      let object;
      try {
        object = await tryGetObject(key);
      } catch (err) {
        const code = (err as { Code?: string; name?: string })?.Code ?? (err as { Code?: string; name?: string })?.name;
        if ((code === 'NoSuchKey' || code === 'NotFound') && legacyKey !== key) {
          object = await tryGetObject(legacyKey);
        } else {
          throw err;
        }
      }

      if (!object.Body) return response.status(404).json({ error: 'File not found in storage' });

      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Content-Type', media.mimeType || 'video/mp4');
      if (typeof object.ContentLength === 'number') {
        response.setHeader('Content-Length', String(object.ContentLength));
      }
      if (object.ContentRange) {
        response.setHeader('Content-Range', object.ContentRange);
      }
      response.status(rangeHeader ? 206 : 200);

      const body = object.Body as AsyncIterable<Uint8Array | Buffer>;
      for await (const chunk of body) {
        const ok = response.write(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
        if (!ok) await new Promise<void>((r) => response.once('drain', r));
      }
      response.end();
    } catch (err) {
      if (!response.headersSent) {
        response.status(500).json({ error: 'Stream failed' });
      }
    }
  }

  /**
   * Extract a frame from a video at the given timestamp (seconds) using ffmpeg
   * and save it as a new media item in the gallery.
   */
  @Post(':id/screenshot')
  async saveScreenshot(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { timestamp?: number },
    @Res() response: Response,
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      select: {
        id: true,
        filePath: true,
        filename: true,
        mimeType: true,
        albumMedia: {
          select: {
            albumId: true,
          },
        },
      },
    });
    if (!media) return response.status(404).json({ error: 'Not found' });

    if (!isVideoFile(media.mimeType, media.filePath)) {
      return response.status(400).json({ error: 'Media is not a video' });
    }

    const rawTs = Number(body.timestamp);
    const timestamp = Number.isFinite(rawTs) && rawTs >= 0 ? rawTs : 0;

    // Download video to a temp file and extract the frame with ffmpeg
    const tmpVidPath = join(tmpdir(), `jry_shot_src_${randomUUID()}${extname(media.filePath) || '.mp4'}`);
    let jpegBuffer: Buffer;
    try {
      await this.streamR2ObjectToFile(req.user!.id, media.filePath, tmpVidPath);
      jpegBuffer = await extractVideoFrameAtTimestamp(tmpVidPath, timestamp);
    } finally {
      await unlink(tmpVidPath).catch(() => {});
    }

    const meta = await sharp(jpegBuffer).metadata();
    const width = meta.width ?? null;
    const height = meta.height ?? null;

    // Build a human-readable timestamp string for the filename (e.g. "01-23" or "1-02-45")
    const totalSec = Math.floor(timestamp);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const tsStr = h > 0
      ? `${String(h).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}`;

    const videoExt = extname(media.filename);
    const videoBase = videoExt ? media.filename.slice(0, -videoExt.length) : media.filename;
    const screenshotFilename = `Screenshot from ${videoBase} at ${tsStr}.jpg`;
    const filePath = `${randomUUID()}.jpg`;
    const mimeType = 'image/jpeg';

    await this.uploadBufferToR2(req.user!.id, filePath, mimeType, jpegBuffer);

    const newMedia = await this.prisma.media.create({
      data: {
        ownerId: req.user!.id,
        filePath,
        filename: screenshotFilename,
        mimeType,
        sizeBytes: jpegBuffer.length,
        width,
        height,
        ...(media.albumMedia[0]?.albumId
          ? {
              albumMedia: {
                create: {
                  albumId: media.albumMedia[0].albumId,
                },
              },
            }
          : {}),
      },
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
    });

    void this.warmThumbCacheAsync(req.user!.id, newMedia.id, filePath, mimeType, newMedia.updatedAt);

    return response.json(newMedia);
  }

  @Get(':id/thumb')
  async thumb(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Query('w') widthQuery: string | undefined,
    @Res() response: Response,
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      select: {
        id: true,
        ownerId: true,
        filePath: true,
        mimeType: true,
        updatedAt: true,
      },
    });

    if (!media) {
      return response.status(404).json({ error: 'Not found' });
    }

    const requestedWidth = Number(widthQuery || 640);
    const thumbWidth = clampInteger(Number.isFinite(requestedWidth) ? requestedWidth : 640, 160, 1600);
    const version = media.updatedAt ? media.updatedAt.getTime() : Date.now();
    const thumbPath = `thumbs/${media.id}_${version}_${thumbWidth}.webp`;

    try {
      const cached = await this.getObjectFromR2(media.ownerId, thumbPath);
      if (cached.Body) {
        const body = await this.readBodyToBuffer(cached.Body);
        response.setHeader('Content-Type', cached.ContentType || 'image/webp');
        response.setHeader('Content-Length', String(body.byteLength));
        response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        return response.send(body);
      }
    } catch {
      // cache miss -> generate below
    }

    try {
      let sourceBuffer: Buffer;
      if (isVideoFile(media.mimeType, media.filePath)) {
        const tmpVidPath = join(tmpdir(), `jry_thumb_${randomUUID()}${extname(media.filePath) || '.mp4'}`);
        try {
          await this.streamR2ObjectToFile(media.ownerId, media.filePath, tmpVidPath);
          sourceBuffer = await extractVideoFrameFromPath(tmpVidPath);
        } finally {
          await unlink(tmpVidPath).catch(() => {});
        }
      } else {
        sourceBuffer = await this.getObjectBufferFromR2(media.ownerId, media.filePath);
      }
      const thumbBuffer = await sharp(sourceBuffer, { failOn: 'none' })
        .rotate()
        .resize({
          width: thumbWidth,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();

      await this.uploadBufferToR2(media.ownerId, thumbPath, 'image/webp', thumbBuffer).catch(() => {
        return;
      });

      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Content-Length', String(thumbBuffer.byteLength));
      response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      return response.send(thumbBuffer);
    } catch {
      try {
        const original = await this.getObjectFromR2(media.ownerId, media.filePath);
        if (!original.Body) {
          return response.status(404).json({ error: 'File not found in storage' });
        }
        const body = await this.readBodyToBuffer(original.Body);
        response.setHeader('Content-Type', original.ContentType || media.mimeType || 'application/octet-stream');
        response.setHeader('Content-Length', String(body.byteLength));
        response.setHeader('Cache-Control', 'private, no-cache');
        return response.send(body);
      } catch {
        return response.status(404).json({ error: 'File not found in storage' });
      }
    }
  }

  @Get(':id/download')
  async downloadSingle(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true, filePath: true, filename: true, mimeType: true },
    });

    if (!media) {
      return response.status(404).json({ error: 'Not found' });
    }

    try {
      const body = await this.getObjectBufferFromR2(req.user!.id, media.filePath);
      response.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
      response.setHeader('Content-Length', String(body.byteLength));
      response.setHeader('Content-Disposition', this.buildContentDisposition(media.filename));
      return response.send(body);
    } catch {
      return response.status(404).json({ error: 'File not found in storage' });
    }
  }

  @Get(':id/share-settings')
  async getShareSettings(@Req() req: RequestWithUser, @Param('id') id: string) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true },
    });

    if (!media) {
      return { error: 'Not found' };
    }

    const settings = await this.prisma.publicShareAccess.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: ShareResourceType.MEDIA,
          resourceId: id,
        },
      },
    });

    if (!settings) {
      return {
        ok: true,
        settings: {
          enabled: false,
          accessMode: 'link',
          hasPassword: false,
          token: null,
          expiresAt: null,
        },
      };
    }

    return {
      ok: true,
      settings: {
        enabled: settings.enabled,
        accessMode: settings.accessMode === ShareAccessMode.PASSWORD ? 'password' : 'link',
        hasPassword: Boolean(settings.passwordHash),
        token: settings.enabled ? settings.token : null,
        expiresAt: settings.expiresAt ? settings.expiresAt.toISOString() : null,
      },
    };
  }

  @Post(':id/share-settings')
  async upsertShareSettings(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { enabled: boolean; accessMode?: 'link' | 'password'; password?: string; expiresAt?: string | null },
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true },
    });

    if (!media) {
      return { error: 'Not found' };
    }

    const accessMode = body.accessMode === 'password' ? ShareAccessMode.PASSWORD : ShareAccessMode.LINK;
    if (body.enabled && accessMode === ShareAccessMode.PASSWORD && !body.password?.trim()) {
      throw new BadRequestException('Password is required for password-protected sharing');
    }

    let expiresAt: Date | null = null;
    if (body.enabled && body.expiresAt) {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid expiresAt value');
      }
      if (parsed.getTime() <= Date.now()) {
        throw new BadRequestException('Expiration must be in the future');
      }
      expiresAt = parsed;
    }

    const existing = await this.prisma.publicShareAccess.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: ShareResourceType.MEDIA,
          resourceId: id,
        },
      },
    });

    const passwordHash =
      accessMode === ShareAccessMode.PASSWORD && body.password?.trim()
        ? await bcrypt.hash(body.password.trim(), 10)
        : accessMode === ShareAccessMode.LINK
          ? null
          : existing?.passwordHash || null;

    const token = existing?.token || createOpaqueShareToken();

    const updated = await this.prisma.publicShareAccess.upsert({
      where: {
        resourceType_resourceId: {
          resourceType: ShareResourceType.MEDIA,
          resourceId: id,
        },
      },
      update: {
        enabled: Boolean(body.enabled),
        accessMode,
        passwordHash,
        expiresAt,
      },
      create: {
        ownerId: req.user!.id,
        resourceType: ShareResourceType.MEDIA,
        resourceId: id,
        token,
        enabled: Boolean(body.enabled),
        accessMode,
        passwordHash,
        expiresAt,
      },
    });

    return {
      ok: true,
      settings: {
        enabled: updated.enabled,
        accessMode: updated.accessMode === ShareAccessMode.PASSWORD ? 'password' : 'link',
        hasPassword: Boolean(updated.passwordHash),
        token: updated.enabled ? updated.token : null,
        expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
      },
    };
  }

  @Post('bulk/download')
  async downloadBulk(
    @Req() req: RequestWithUser,
    @Body() body: { mediaIds: string[] },
    @Res() response: Response,
  ) {
    const mediaIds = Array.from(new Set((body.mediaIds || []).map((item) => String(item)).filter(Boolean)));
    if (mediaIds.length === 0) {
      throw new BadRequestException('No media selected');
    }

    const mediaItems = await this.prisma.media.findMany({
      where: {
        ownerId: req.user!.id,
        id: { in: mediaIds },
      },
      select: {
        id: true,
        filePath: true,
        filename: true,
      },
    });

    if (mediaItems.length === 0) {
      throw new BadRequestException('No accessible media found');
    }

    const zip = new JSZip();
    const usedNames = new Map<string, number>();

    for (const media of mediaItems) {
      const baseName = this.normalizeDownloadFileName(media.filename);
      const dotIndex = baseName.lastIndexOf('.');
      const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
      const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
      const existingCount = usedNames.get(baseName) || 0;
      usedNames.set(baseName, existingCount + 1);
      const finalName = existingCount > 0 ? `${stem} (${existingCount + 1})${ext}` : baseName;

      try {
        const fileBuffer = await this.getObjectBufferFromR2(req.user!.id, media.filePath);
        zip.file(finalName, fileBuffer);
      } catch {
        continue;
      }
    }

    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Length', String(archive.byteLength));
    response.setHeader('Content-Disposition', this.buildContentDisposition('jellyree-media.zip'));
    return response.send(archive);
  }

  @Patch(':id')
  async update(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body()
    body: {
      filename?: string;
      tags?: string[];
      isFavorite?: boolean;
      capturedAt?: string | null;
      metadataCreatedAt?: string | null;
      metadataModifiedAt?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    },
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
    });

    if (!media) {
      return { error: 'Not found' };
    }

    await this.clearMediaRevisions(media.id, media.ownerId);

    let nextCapturedAt = media.capturedAt;
    if (body.capturedAt !== undefined) {
      if (!body.capturedAt) {
        nextCapturedAt = null;
      } else {
        const parsedCapturedAt = normalizeExifDate(body.capturedAt);
        if (!parsedCapturedAt) {
          throw new BadRequestException('Invalid capturedAt date');
        }
        nextCapturedAt = parsedCapturedAt;
      }
    }

    let nextMetadataCreatedAt = media.metadataCreatedAt;
    if (body.metadataCreatedAt !== undefined) {
      if (!body.metadataCreatedAt) {
        nextMetadataCreatedAt = null;
      } else {
        const parsedMetadataCreatedAt = normalizeExifDate(body.metadataCreatedAt);
        if (!parsedMetadataCreatedAt) {
          throw new BadRequestException('Invalid metadataCreatedAt date');
        }
        nextMetadataCreatedAt = parsedMetadataCreatedAt;
      }
    }

    let nextMetadataModifiedAt = media.metadataModifiedAt;
    if (body.metadataModifiedAt !== undefined) {
      if (!body.metadataModifiedAt) {
        nextMetadataModifiedAt = null;
      } else {
        const parsedMetadataModifiedAt = normalizeExifDate(body.metadataModifiedAt);
        if (!parsedMetadataModifiedAt) {
          throw new BadRequestException('Invalid metadataModifiedAt date');
        }
        nextMetadataModifiedAt = parsedMetadataModifiedAt;
      }
    }

    let nextLatitude = media.latitude;
    if (body.latitude !== undefined) {
      if (body.latitude === null) {
        nextLatitude = null;
      } else {
        const parsedLatitude = Number(body.latitude);
        if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90) {
          throw new BadRequestException('Invalid latitude');
        }
        nextLatitude = parsedLatitude;
      }
    }

    let nextLongitude = media.longitude;
    if (body.longitude !== undefined) {
      if (body.longitude === null) {
        nextLongitude = null;
      } else {
        const parsedLongitude = Number(body.longitude);
        if (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
          throw new BadRequestException('Invalid longitude');
        }
        nextLongitude = parsedLongitude;
      }
    }

    const updated = await this.prisma.media.update({
      where: { id },
      data: {
        filename: body.filename?.trim() || media.filename,
        capturedAt: nextCapturedAt,
        metadataCreatedAt: nextMetadataCreatedAt,
        metadataModifiedAt: nextMetadataModifiedAt,
        latitude: nextLatitude,
        longitude: nextLongitude,
        ...(typeof body.isFavorite === 'boolean'
          ? { isFavorite: body.isFavorite }
          : {}),
      },
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
    });

    if (body.tags) {
      const normalized = Array.from(
        new Set(body.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
      );

      await this.prisma.mediaTag.deleteMany({ where: { mediaId: id } });

      if (normalized.length > 0) {
        const tags = await Promise.all(
          normalized.map((name) =>
            this.prisma.tag.upsert({
              where: {
                ownerId_name: {
                  ownerId: req.user!.id,
                  name,
                },
              },
              create: { ownerId: req.user!.id, name },
              update: {},
            }),
          ),
        );

        await this.prisma.mediaTag.createMany({
          data: tags.map((tag) => ({ mediaId: id, tagId: tag.id })),
        });
      }
    }

    return this.prisma.media.findUnique({
      where: { id },
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
    });
  }

  @Post(':id/copy')
  async copy(@Req() req: RequestWithUser, @Param('id') id: string) {
    const source = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      include: {
        mediaTags: true,
        albumMedia: true,
      },
    });

    if (!source) {
      return { error: 'Not found' };
    }

    await this.ensureCanCreateFiles(req.user!.id, 1, source.sizeBytes);

    const sourceBody = await this.getObjectBufferFromR2(req.user!.id, source.filePath);
    const storageExtension = extname(source.filePath) || extname(source.filename) || '.bin';
    const copyStoragePath = `${randomUUID()}${storageExtension}`;

    await this.uploadBufferToR2(req.user!.id, copyStoragePath, source.mimeType, sourceBody);

    try {
      const copied = await this.prisma.$transaction(async (tx) => {
        const created = await tx.media.create({
          data: {
            ownerId: source.ownerId,
            filePath: copyStoragePath,
            filename: source.filename,
            relativePath: source.relativePath,
            isFavorite: source.isFavorite,
            mimeType: source.mimeType,
            sizeBytes: source.sizeBytes,
            width: source.width,
            height: source.height,
            adjustments: source.adjustments ?? Prisma.JsonNull,
            capturedAt: source.capturedAt,
            metadataCreatedAt: source.metadataCreatedAt,
            metadataModifiedAt: source.metadataModifiedAt,
            latitude: source.latitude,
            longitude: source.longitude,
          },
          include: {
            mediaTags: { include: { tag: true } },
            albumMedia: true,
          },
        });

        const sourceAlbumId = source.albumMedia[0]?.albumId;
        if (sourceAlbumId) {
          await tx.albumMedia.create({
            data: {
              albumId: sourceAlbumId,
              mediaId: created.id,
            },
          });
        }

        if (source.mediaTags.length > 0) {
          await tx.mediaTag.createMany({
            data: source.mediaTags.map((entry) => ({
              mediaId: created.id,
              tagId: entry.tagId,
            })),
          });
        }

        return tx.media.findUnique({
          where: { id: created.id },
          include: {
            mediaTags: { include: { tag: true } },
            albumMedia: true,
          },
        });
      });

      return copied;
    } catch (error) {
      await this.deleteObjectFromR2(req.user!.id, copyStoragePath).catch(() => {
        return;
      });
      throw error;
    }
  }

  @Post(':id/convert-jpg')
  async convertToJpg(@Req() req: RequestWithUser, @Param('id') id: string) {
    const source = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      include: {
        mediaTags: true,
        albumMedia: true,
      },
    });

    if (!source) {
      return { error: 'Not found' };
    }

    if (!source.mimeType.toLowerCase().startsWith('image/')) {
      throw new BadRequestException('Only image files can be converted to JPG');
    }

    const sourceBody = await this.getObjectBufferFromR2(req.user!.id, source.filePath);
    const convertedBuffer = await sharp(sourceBody, { failOn: 'none' })
      .rotate()
      // Preserve source ICC profile to avoid color shifts (e.g. wide-gamut photos looking faded).
      .keepIccProfile()
      .jpeg({
        quality: 100,
        chromaSubsampling: '4:4:4',
        mozjpeg: false,
        progressive: false,
      })
      .toBuffer();

    const convertedMeta = await sharp(convertedBuffer, { failOn: 'none' }).metadata();
    await this.ensureCanCreateFiles(req.user!.id, 1, convertedBuffer.byteLength);
    const convertedStoragePath = `${randomUUID()}.jpg`;
    const convertedFilename = this.buildJpegFilename(source.filename);

    await this.uploadBufferToR2(req.user!.id, convertedStoragePath, 'image/jpeg', convertedBuffer);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.media.create({
          data: {
            ownerId: source.ownerId,
            filePath: convertedStoragePath,
            filename: convertedFilename,
            relativePath: source.relativePath,
            isFavorite: source.isFavorite,
            mimeType: 'image/jpeg',
            sizeBytes: convertedBuffer.byteLength,
            width: convertedMeta.width || source.width,
            height: convertedMeta.height || source.height,
            adjustments: Prisma.JsonNull,
            capturedAt: source.capturedAt,
            metadataCreatedAt: source.metadataCreatedAt,
            metadataModifiedAt: source.metadataModifiedAt,
            latitude: source.latitude,
            longitude: source.longitude,
          },
          include: {
            mediaTags: { include: { tag: true } },
            albumMedia: true,
          },
        });

        const sourceAlbumId = source.albumMedia[0]?.albumId;
        if (sourceAlbumId) {
          await tx.albumMedia.create({
            data: {
              albumId: sourceAlbumId,
              mediaId: inserted.id,
            },
          });
        }

        if (source.mediaTags.length > 0) {
          await tx.mediaTag.createMany({
            data: source.mediaTags.map((entry) => ({
              mediaId: inserted.id,
              tagId: entry.tagId,
            })),
          });
        }

        return tx.media.findUnique({
          where: { id: inserted.id },
          include: {
            mediaTags: { include: { tag: true } },
            albumMedia: true,
          },
        });
      });

      return created;
    } catch (error) {
      await this.deleteObjectFromR2(req.user!.id, convertedStoragePath).catch(() => {
        return;
      });
      throw error;
    }
  }

  @Post(':id/preview-render')
  async previewRender(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { adjustments?: Record<string, unknown>; deformation?: EditorDeformationPayload },
    @Res() response: Response,
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true, ownerId: true, filePath: true, mimeType: true },
    });

    if (!media) {
      return response.status(404).json({ error: 'Not found' });
    }

    if (!media.mimeType.toLowerCase().startsWith('image/')) {
      throw new BadRequestException('Only image files can be edited');
    }

    const normalized = normalizeEditorAdjustments(body.adjustments);
    const normalizedDeformation = normalizeEditorDeformation(body.deformation);
    const sourceBuffer = await this.getObjectBufferFromR2(media.ownerId, media.filePath);
    const previewBuffer = await this.renderEditedImageBuffer(sourceBuffer, normalized, {
      preview: true,
      deformation: normalizedDeformation,
    });

    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.setHeader('Content-Length', String(previewBuffer.byteLength));
    return response.send(previewBuffer);
  }

  @Post(':id/apply-edits')
  async applyEdits(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { adjustments?: Record<string, unknown>; deformation?: EditorDeformationPayload },
  ) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
    });

    if (!media) {
      return { error: 'Not found' };
    }

    if (!media.mimeType.toLowerCase().startsWith('image/')) {
      throw new BadRequestException('Only image files can be edited');
    }
    const normalized = normalizeEditorAdjustments(body.adjustments);
    const normalizedDeformation = normalizeEditorDeformation(body.deformation);

    await this.clearMediaRevisions(media.id, media.ownerId);

    const sourceBuffer = await this.getObjectBufferFromR2(media.ownerId, media.filePath);
    const outputBuffer = await this.renderEditedImageBuffer(sourceBuffer, normalized, {
      deformation: normalizedDeformation,
    });

    await this.uploadBufferToR2(media.ownerId, media.filePath, media.mimeType, outputBuffer);

    const outputMeta = await sharp(outputBuffer, { failOn: 'none' }).metadata();

    await this.prisma.media.update({
      where: { id },
      data: {
        width: outputMeta.width || null,
        height: outputMeta.height || null,
        sizeBytes: Number(outputBuffer.byteLength),
        adjustments: Prisma.JsonNull,
      },
    });

    return this.prisma.media.findUnique({
      where: { id },
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
    });
  }

  @Post(':id/revert-edits')
  async revertEdits(@Req() req: RequestWithUser, @Param('id') id: string) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
    });

    if (!media) {
      return { error: 'Not found' };
    }

    const latestRevision = await this.prisma.mediaRevision.findFirst({
      where: { mediaId: id },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestRevision) {
      return { error: 'No undo history for this photo' };
    }

    const revisionBuffer = await this.getObjectBufferFromR2(media.ownerId, latestRevision.filePath);
    await this.uploadBufferToR2(media.ownerId, media.filePath, media.mimeType, revisionBuffer);

    const outputMeta = await sharp(revisionBuffer, { failOn: 'none' }).metadata();

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaRevision.delete({ where: { id: latestRevision.id } });
      await tx.media.update({
        where: { id },
        data: {
          width: outputMeta.width || null,
          height: outputMeta.height || null,
          sizeBytes: Number(revisionBuffer.byteLength),
          adjustments: Prisma.JsonNull,
        },
      });
    });

    await this.deleteObjectFromR2(media.ownerId, latestRevision.filePath).catch(() => {
      return;
    });

    return this.prisma.media.findUnique({
      where: { id },
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
    });
  }

  @Delete(':id')
  async remove(@Req() req: RequestWithUser, @Param('id') id: string) {
    const media = await this.prisma.media.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true, filePath: true },
    });

    if (!media) {
      return { error: 'Not found' };
    }

    const revisions = await this.prisma.mediaRevision.findMany({
      where: { mediaId: id },
      select: { filePath: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaRevision.deleteMany({ where: { mediaId: id } });
      await tx.mediaTag.deleteMany({ where: { mediaId: id } });
      await tx.albumMedia.deleteMany({ where: { mediaId: id } });
      await tx.media.delete({ where: { id } });
    });

    await this.deleteObjectFromR2(req.user!.id, media.filePath);

    await Promise.all(
      revisions.map((entry) => this.deleteObjectFromR2(req.user!.id, entry.filePath)),
    );

    return { ok: true };
  }

  @Post('bulk/tag')
  async bulkTag(
    @Req() req: RequestWithUser,
    @Body() body: { mediaIds: string[]; tags: string[] },
  ) {
    const mediaIds = Array.from(new Set(body.mediaIds || []));
    const tags = Array.from(
      new Set((body.tags || []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
    );

    if (mediaIds.length === 0 || tags.length === 0) {
      return { ok: true, created: 0 };
    }

    const dbTags = await Promise.all(
      tags.map((name) =>
        this.prisma.tag.upsert({
          where: {
            ownerId_name: {
              ownerId: req.user!.id,
              name,
            },
          },
          create: { ownerId: req.user!.id, name },
          update: {},
        }),
      ),
    );

    let created = 0;
    for (const mediaId of mediaIds) {
      for (const tag of dbTags) {
        try {
          await this.prisma.mediaTag.create({
            data: { mediaId, tagId: tag.id },
          });
          created += 1;
        } catch {
          // ignore duplicates
        }
      }
    }

    return { ok: true, created };
  }

  @Post('bulk/move-album')
  async bulkMoveAlbum(
    @Req() req: RequestWithUser,
    @Body() body: { mediaIds: string[]; albumId: string },
  ) {
    const mediaIds = Array.from(new Set(body.mediaIds || []));

    if (!body.albumId || mediaIds.length === 0) {
      return { ok: true, created: 0 };
    }

    const album = await this.prisma.album.findFirst({
      where: { id: body.albumId, ownerId: req.user!.id },
    });

    if (!album) {
      return { error: 'Album not found' };
    }

    const available = await this.prisma.media.findMany({
      where: {
        id: { in: mediaIds },
        ownerId: req.user!.id,
      },
      select: { id: true },
    });

    let moved = 0;
    for (const media of available) {
      await this.prisma.albumMedia.upsert({
        where: { mediaId: media.id },
        update: { albumId: body.albumId },
        create: { albumId: body.albumId, mediaId: media.id },
      });
      moved += 1;
    }

    return { ok: true, moved };
  }

  @Post('bulk/favorite')
  async bulkFavorite(
    @Req() req: RequestWithUser,
    @Body() body: { mediaIds: string[]; isFavorite: boolean },
  ) {
    const mediaIds = Array.from(new Set(body.mediaIds || []));

    if (mediaIds.length === 0) {
      return { ok: true, updated: 0 };
    }

    const result = await this.prisma.media.updateMany({
      where: {
        id: { in: mediaIds },
        ownerId: req.user!.id,
      },
      data: {
        isFavorite: Boolean(body.isFavorite),
      },
    });

    return { ok: true, updated: result.count };
  }

  @Post('bulk/delete')
  async bulkDelete(
    @Req() req: RequestWithUser,
    @Body() body: { mediaIds: string[] },
  ) {
    const mediaIds = Array.from(new Set(body.mediaIds || []));

    if (mediaIds.length === 0) {
      return { ok: true, deleted: 0 };
    }

    const ownedMedia = await this.prisma.media.findMany({
      where: {
        id: { in: mediaIds },
        ownerId: req.user!.id,
      },
      select: { id: true, filePath: true },
    });

    const ownedIds = ownedMedia.map((item) => item.id);
    if (ownedIds.length === 0) {
      return { ok: true, deleted: 0 };
    }

    const revisions = await this.prisma.mediaRevision.findMany({
      where: { mediaId: { in: ownedIds } },
      select: { filePath: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaRevision.deleteMany({ where: { mediaId: { in: ownedIds } } });
      await tx.mediaTag.deleteMany({ where: { mediaId: { in: ownedIds } } });
      await tx.albumMedia.deleteMany({ where: { mediaId: { in: ownedIds } } });
      await tx.media.deleteMany({ where: { id: { in: ownedIds } } });
    });

    await Promise.all(ownedMedia.map((item) => this.deleteObjectFromR2(req.user!.id, item.filePath)));

    await Promise.all(
      revisions.map((entry) => this.deleteObjectFromR2(req.user!.id, entry.filePath)),
    );

    return { ok: true, deleted: ownedIds.length };
  }
}
