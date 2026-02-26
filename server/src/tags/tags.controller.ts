import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestWithUser } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() req: RequestWithUser) {
    return this.prisma.tag.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  async create(@Req() req: RequestWithUser, @Body() body: { name: string }) {
    const normalized = body.name?.trim().toLowerCase();
    if (!normalized) {
      return { error: 'Tag name required' };
    }

    return this.prisma.tag.upsert({
      where: {
        ownerId_name: {
          ownerId: req.user!.id,
          name: normalized,
        },
      },
      create: {
        ownerId: req.user!.id,
        name: normalized,
      },
      update: {},
    });
  }
}
