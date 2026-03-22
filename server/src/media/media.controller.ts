import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { extname, resolve } from 'path';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { unlink } from 'fs/promises';
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
const r2Endpoint =
  process.env.R2_ENDPOINT ||
  (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}

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
    return client.send(
      new GetObjectCommand({
        Bucket: r2BucketName,
        Key: this.objectKey(ownerId, relativePath),
      }),
    );
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

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('favorite') favorite?: string,
    @Query('tag') tag?: string,
    @Query('albumId') albumId?: string,
  ) {
    const pageNumber = toNumber(page, 1);
    const pageSize = clamp(toNumber(limit, 20), 1, 100);
    const offset = Math.max(pageNumber - 1, 0) * pageSize;
    const favoriteOnly = favorite === 'true';

    const items = await this.prisma.media.findMany({
      where: {
        ownerId: req.user!.id,
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
                some: { albumId },
              },
            }
          : {}),
      },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        mediaTags: {
          include: { tag: true },
        },
        albumMedia: true,
        _count: {
          select: { revisions: true },
        },
      },
    });

    return items.map((item) => ({
      ...item,
      revisionCount: item._count.revisions,
    }));
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

    const uploadMetadata = await Promise.all(
      (files || []).map((file) => this.readUploadMetadata(file.filename, file.mimetype)),
    );

    const ownerId = req.user!.id;
    const tempFilePaths = (files || []).map((file) => resolve(tempUploadRoot, file.filename));

    try {
      await Promise.all(
        (files || []).map((file, index) =>
          this.uploadLocalFileToR2(ownerId, file.filename, file.mimetype, tempFilePaths[index]),
        ),
      );
    } catch (error) {
      await Promise.all(tempFilePaths.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }

    let created: Awaited<ReturnType<typeof this.prisma.media.create>>[] = [];

    try {
      created = await this.prisma.$transaction(
        (files || []).map((file, index) => {
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

          return this.prisma.media.create({
            data: {
              ownerId,
              filePath: file.filename,
              filename: file.originalname,
              relativePath: relativePaths[index] || null,
              mimeType: file.mimetype,
              sizeBytes: file.size,
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
        }),
      );
    } catch (error) {
      await Promise.all(
        (files || []).map((file) => this.deleteObjectFromR2(ownerId, file.filename).catch(() => undefined)),
      );
      await Promise.all(tempFilePaths.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }

    await Promise.all(tempFilePaths.map((path) => unlink(path).catch(() => undefined)));

    const createAlbumsFromFolders =
      body.createAlbumsFromFolders === true || body.createAlbumsFromFolders === 'true';

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
      const sourceBuffer = await this.getObjectBufferFromR2(media.ownerId, media.filePath);
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

  @Post(':id/apply-edits')
  async applyEdits(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { adjustments?: Record<string, number> },
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

    const adjustments = body.adjustments || {};
    const temperature = clamp(toNumber(adjustments.temperature, 0), -100, 100);
    const brightness = clamp(toNumber(adjustments.brightness, 0), -80, 80);
    const contrast = clamp(toNumber(adjustments.contrast, 0), -80, 80);
    const saturation = clamp(toNumber(adjustments.saturation, 0), -80, 80);
    const toneDepth = clamp(toNumber(adjustments.toneDepth, 0), -100, 100);
    const shadowsLevel = clamp(toNumber(adjustments.shadowsLevel, 0), -100, 100);
    const highlightsLevel = clamp(toNumber(adjustments.highlightsLevel, 0), -100, 100);
    const sharpness = clamp(toNumber(adjustments.sharpness, 0), 0, 100);
    const definition = clamp(toNumber(adjustments.definition, 0), -100, 100);
    const vignette = clamp(toNumber(adjustments.vignette, 0), 0, 100);
    const glamour = clamp(toNumber(adjustments.glamour, 0), 0, 100);
    const grayscale = clamp(toNumber(adjustments.grayscale, 0), 0, 100);
    const sepia = clamp(toNumber(adjustments.sepia, 0), 0, 100);
    const cropZoom = clamp(toNumber(adjustments.cropZoom, 0), 0, 90);
    const rotate = clamp(toNumber(adjustments.rotate, 0), -180, 180);
    const flipX = toNumber(adjustments.flipX, 0) > 0;
    const flipY = toNumber(adjustments.flipY, 0) > 0;
    const cropX = clamp(toNumber(adjustments.cropX, 0), 0, 95);
    const cropY = clamp(toNumber(adjustments.cropY, 0), 0, 95);
    const cropWidth = clamp(toNumber(adjustments.cropWidth, 100), 5, 100 - cropX);
    const cropHeight = clamp(toNumber(adjustments.cropHeight, 100), 5, 100 - cropY);

    await this.clearMediaRevisions(media.id, media.ownerId);

    const sourceBuffer = await this.getObjectBufferFromR2(media.ownerId, media.filePath);
    try {
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

      const brightnessFactor = Math.max(0, 1 + brightness / 100);
      const saturationFactor = Math.max(0, (1 + saturation / 100) * (1 - grayscale / 100));

      pipeline = pipeline.modulate({
        brightness: brightnessFactor,
        saturation: saturationFactor,
      });

      if (temperature !== 0) {
        const warmFactor = temperature / 100;
        const redGain = clamp(1 + warmFactor * 0.38, 0.6, 1.5);
        const greenGain = clamp(1 + warmFactor * 0.08, 0.75, 1.3);
        const blueGain = clamp(1 - warmFactor * 0.34, 0.55, 1.5);
        pipeline = pipeline.linear([redGain, greenGain, blueGain]);
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

      let outputBuffer = await pipeline.toBuffer();

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
    } catch (error) {
      throw error;
    }

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
