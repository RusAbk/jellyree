import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Response } from 'express';
import * as bcrypt from 'bcrypt';
import {
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ShareAccessMode, ShareResourceType } from '@prisma/client';

const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2BucketName = process.env.R2_BUCKET_NAME || '';
const r2Endpoint =
  process.env.R2_ENDPOINT ||
  (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');

@Controller('public')
export class PublicShareController {
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

  private async resolveAccess(
    token: string,
    resourceType: ShareResourceType,
    password?: string,
  ) {
    const access = await this.prisma.publicShareAccess.findFirst({
      where: {
        token,
        resourceType,
      },
    });

    if (!access || !access.enabled) {
      return { error: 'Invalid share link', status: 404 as const };
    }

    if (access.expiresAt && access.expiresAt.getTime() <= Date.now()) {
      return { error: 'Share link expired', status: 404 as const };
    }

    if (access.accessMode === ShareAccessMode.PASSWORD) {
      if (!password) {
        return { error: 'Password required', status: 401 as const };
      }
      const valid = access.passwordHash
        ? await bcrypt.compare(password, access.passwordHash)
        : false;
      if (!valid) {
        return { error: 'Invalid password', status: 401 as const };
      }
    }

    return { access };
  }

  @Get('media/:token')
  async publicMedia(@Param('token') token: string, @Query('password') password?: string) {
    const resolved = await this.resolveAccess(token, ShareResourceType.MEDIA, password);
    if ('error' in resolved) {
      if (resolved.status === 401) {
        throw new UnauthorizedException(resolved.error);
      }
      throw new NotFoundException(resolved.error);
    }

    const media = await this.prisma.media.findUnique({
      where: { id: resolved.access.resourceId },
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
    });

    if (!media) {
      return { error: 'Not found' };
    }

    return { ok: true, media };
  }

  @Get('media/:token/file')
  async publicMediaFile(
    @Param('token') token: string,
    @Query('password') password: string | undefined,
    @Res() response: Response,
  ) {
    const resolved = await this.resolveAccess(token, ShareResourceType.MEDIA, password);
    if ('error' in resolved) {
      const status = resolved.status === 401 ? 401 : 404;
      return response.status(status).json({ error: resolved.error });
    }

    const media = await this.prisma.media.findUnique({
      where: { id: resolved.access.resourceId },
      select: { ownerId: true, filePath: true, mimeType: true },
    });

    if (!media) {
      return response.status(404).json({ error: 'Not found' });
    }

    try {
      const object = await this.getR2Client().send(
        new GetObjectCommand({
          Bucket: r2BucketName,
          Key: this.objectKey(media.ownerId, media.filePath),
        }),
      );
      if (!object.Body) {
        return response.status(404).json({ error: 'File not found in storage' });
      }
      const body = await this.readBodyToBuffer(object.Body);
      response.setHeader('Content-Type', object.ContentType || media.mimeType || 'application/octet-stream');
      return response.send(body);
    } catch {
      return response.status(404).json({ error: 'File not found in storage' });
    }
  }

  @Get('albums/:token')
  async publicAlbum(@Param('token') token: string, @Query('password') password?: string) {
    const resolved = await this.resolveAccess(token, ShareResourceType.ALBUM, password);
    if ('error' in resolved) {
      if (resolved.status === 401) {
        throw new UnauthorizedException(resolved.error);
      }
      throw new NotFoundException(resolved.error);
    }

    const album = await this.prisma.album.findUnique({
      where: { id: resolved.access.resourceId },
      select: {
        id: true,
        name: true,
        description: true,
        ownerId: true,
      },
    });

    if (!album) {
      return { error: 'Not found' };
    }

    const media = await this.prisma.media.findMany({
      where: {
        ownerId: album.ownerId,
        albumMedia: {
          some: { albumId: album.id },
        },
      },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        mediaTags: { include: { tag: true } },
        albumMedia: true,
      },
    });

    return {
      ok: true,
      album: {
        id: album.id,
        name: album.name,
        description: album.description,
      },
      media,
    };
  }

  @Get('albums/:token/media/:mediaId/file')
  async publicAlbumMediaFile(
    @Param('token') token: string,
    @Param('mediaId') mediaId: string,
    @Query('password') password: string | undefined,
    @Res() response: Response,
  ) {
    const resolved = await this.resolveAccess(token, ShareResourceType.ALBUM, password);
    if ('error' in resolved) {
      const status = resolved.status === 401 ? 401 : 404;
      return response.status(status).json({ error: resolved.error });
    }

    const album = await this.prisma.album.findUnique({
      where: { id: resolved.access.resourceId },
      select: { id: true, ownerId: true },
    });

    if (!album) {
      return response.status(404).json({ error: 'Not found' });
    }

    const media = await this.prisma.media.findFirst({
      where: {
        id: mediaId,
        ownerId: album.ownerId,
        albumMedia: {
          some: { albumId: album.id },
        },
      },
      select: {
        ownerId: true,
        filePath: true,
        mimeType: true,
      },
    });

    if (!media) {
      return response.status(404).json({ error: 'Not found' });
    }

    try {
      const object = await this.getR2Client().send(
        new GetObjectCommand({
          Bucket: r2BucketName,
          Key: this.objectKey(media.ownerId, media.filePath),
        }),
      );
      if (!object.Body) {
        return response.status(404).json({ error: 'File not found in storage' });
      }
      const body = await this.readBodyToBuffer(object.Body);
      response.setHeader('Content-Type', object.ContentType || media.mimeType || 'application/octet-stream');
      return response.send(body);
    } catch {
      return response.status(404).json({ error: 'File not found in storage' });
    }
  }
}
