import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestWithUser } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('albums')
export class AlbumsController {
  constructor(private readonly prisma: PrismaService) {}

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

    return albums.map((album) => ({
      ...album,
      mediaCount: album._count.albumMedia,
    }));
  }

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Body() body: { name: string; description?: string; parentId?: string | null },
  ) {
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
}
