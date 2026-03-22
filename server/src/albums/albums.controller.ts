import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestWithUser } from '../auth/jwt-auth.guard';
import { createOpaqueShareToken } from '../media/share-token';
import { ShareAccessMode, ShareResourceType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@UseGuards(JwtAuthGuard)
@Controller('albums')
export class AlbumsController {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureCanCreateAlbums(ownerId: string, delta: number) {
    if (delta <= 0) return;

    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, maxAlbumCount: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.maxAlbumCount == null) return;

    const currentAlbumCount = await this.prisma.album.count({ where: { ownerId } });
    if (currentAlbumCount + delta > user.maxAlbumCount) {
      throw new BadRequestException(
        `Album limit reached (${user.maxAlbumCount}). Delete albums or set unlimited in admin panel.`,
      );
    }
  }

  @Get()
  async list(@Req() req: RequestWithUser) {
    const albums = await this.prisma.album.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { albumMedia: true },
        },
      },
    });

    const albumIds = albums.map((album) => album.id);
    const previewByAlbum = new Map<string, Array<{ id: string; filename: string; mimeType: string }>>();

    if (albumIds.length > 0) {
      const previewMedia = await this.prisma.media.findMany({
        where: {
          ownerId: req.user!.id,
          albumMedia: {
            some: {
              albumId: {
                in: albumIds,
              },
            },
          },
        },
        orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          filename: true,
          mimeType: true,
          albumMedia: {
            select: {
              albumId: true,
            },
          },
        },
      });

      for (const item of previewMedia) {
        const albumId = item.albumMedia[0]?.albumId;
        if (!albumId) continue;
        const bucket = previewByAlbum.get(albumId) || [];
        if (bucket.length >= 4) continue;
        bucket.push({ id: item.id, filename: item.filename, mimeType: item.mimeType });
        previewByAlbum.set(albumId, bucket);
      }
    }

    return albums.map((album) => ({
      ...album,
      mediaCount: album._count.albumMedia,
      previewMedia: previewByAlbum.get(album.id) || [],
    }));
  }

  @Post()
  async create(
    @Req() req: RequestWithUser,
    @Body() body: { name: string; description?: string; parentId?: string | null },
  ) {
    await this.ensureCanCreateAlbums(req.user!.id, 1);

    return this.prisma.album.create({
      data: {
        ownerId: req.user!.id,
        name: body.name?.trim() || 'Untitled album',
        description: body.description,
        parentId: body.parentId || null,
      },
    });
  }

  @Post(':id')
  async update(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { name?: string; parentId?: string | null },
  ) {
    const album = await this.prisma.album.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true },
    });

    if (!album) {
      return { error: 'Album not found' };
    }

    if (body.parentId === id) {
      return { error: 'Album cannot be parent of itself' };
    }

    if (body.parentId) {
      const parent = await this.prisma.album.findFirst({
        where: { id: body.parentId, ownerId: req.user!.id },
        select: { id: true, parentId: true },
      });

      if (!parent) {
        return { error: 'Parent album not found' };
      }

      let cursorParentId: string | null = parent.parentId;
      while (cursorParentId) {
        if (cursorParentId === id) {
          return { error: 'Album cannot be moved into its descendant' };
        }

        const cursor = await this.prisma.album.findFirst({
          where: { id: cursorParentId, ownerId: req.user!.id },
          select: { parentId: true },
        });

        cursorParentId = cursor?.parentId || null;
      }
    }

    return this.prisma.album.update({
      where: { id },
      data: {
        ...(typeof body.name === 'string' ? { name: body.name.trim() || 'Untitled album' } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId || null } : {}),
      },
    });
  }

  @Delete(':id')
  async remove(@Req() req: RequestWithUser, @Param('id') id: string) {
    const album = await this.prisma.album.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true, parentId: true },
    });

    if (!album) {
      return { error: 'Album not found' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.album.updateMany({
        where: { ownerId: req.user!.id, parentId: id },
        data: { parentId: album.parentId || null },
      });
      await tx.albumMedia.deleteMany({ where: { albumId: id } });
      await tx.album.delete({ where: { id } });
    });

    return { ok: true };
  }

  @Post(':id/media')
  async addMedia(
    @Req() req: RequestWithUser,
    @Param('id') albumId: string,
    @Body() body: { mediaIds: string[] },
  ) {
    const mediaIds = Array.from(new Set(body.mediaIds || []));

    const album = await this.prisma.album.findFirst({
      where: { id: albumId, ownerId: req.user!.id },
    });

    if (!album) {
      return { error: 'Album not found' };
    }

    if (mediaIds.length === 0) {
      return { ok: true, moved: 0 };
    }

    const available = await this.prisma.media.findMany({
      where: {
        id: { in: mediaIds },
        ownerId: req.user!.id,
      },
      select: { id: true },
    });
    const availableIds = available.map((item) => item.id);

    for (const mediaId of availableIds) {
      await this.prisma.albumMedia.upsert({
        where: { mediaId },
        update: { albumId },
        create: { albumId, mediaId },
      });
    }

    return { ok: true, moved: availableIds.length };
  }

  @Get(':id/share-settings')
  async getShareSettings(@Req() req: RequestWithUser, @Param('id') id: string) {
    const album = await this.prisma.album.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true },
    });

    if (!album) {
      return { error: 'Album not found' };
    }

    const settings = await this.prisma.publicShareAccess.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: ShareResourceType.ALBUM,
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
    const album = await this.prisma.album.findFirst({
      where: { id, ownerId: req.user!.id },
      select: { id: true },
    });

    if (!album) {
      return { error: 'Album not found' };
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
          resourceType: ShareResourceType.ALBUM,
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
          resourceType: ShareResourceType.ALBUM,
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
        resourceType: ShareResourceType.ALBUM,
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
}
