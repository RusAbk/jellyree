import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2BucketName = process.env.R2_BUCKET_NAME || '';
const r2Endpoint =
  process.env.R2_ENDPOINT ||
  (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');

@Injectable()
export class AuthService {
  private r2Client: S3Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private getR2Client() {
    if (this.r2Client) return this.r2Client;

    if (!r2AccessKeyId || !r2SecretAccessKey || !r2BucketName || !r2Endpoint) {
      return null;
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

  private async deleteObjectsFromR2(ownerId: string, filePaths: string[]) {
    const client = this.getR2Client();
    if (!client || filePaths.length === 0) return;

    await Promise.all(
      filePaths.map((filePath) =>
        client
          .send(
            new DeleteObjectCommand({
              Bucket: r2BucketName,
              Key: `${ownerId}/${String(filePath).replace(/^\/+/, '')}`,
            }),
          )
          .catch(() => undefined),
      ),
    );
  }

  async register(email: string, password: string, displayName?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userCount = await this.prisma.user.count({ where: { deletedAt: null } });

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        isAdmin: userCount === 0,
      },
    });

    return this.issueToken(user.id, user.email, user.displayName, user.isAdmin);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.deletedAt) {
      throw new ForbiddenException('Account was deleted');
    }

    if (user.isFrozen) {
      throw new ForbiddenException('Account is frozen');
    }

    return this.issueToken(user.id, user.email, user.displayName, user.isAdmin);
  }

  async adminLogin(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.deletedAt) {
      throw new ForbiddenException('Account was deleted');
    }

    if (user.isFrozen) {
      throw new ForbiddenException('Account is frozen');
    }

    let isAdmin = Boolean(user.isAdmin);
    if (!isAdmin) {
      const adminsCount = await this.prisma.user.count({
        where: { isAdmin: true, deletedAt: null },
      });
      if (adminsCount === 0) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { isAdmin: true },
        });
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return this.issueToken(user.id, user.email, user.displayName, true);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        isAdmin: true,
        isFrozen: true,
        deletedAt: true,
        maxTotalSizeBytes: true,
        maxFileCount: true,
        maxAlbumCount: true,
        createdAt: true,
      },
    });
  }

  async adminUsers(requesterId: string) {
    await this.ensureAdmin(requesterId);

    const [users, mediaStats, albumStats] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          displayName: true,
          isAdmin: true,
          isFrozen: true,
          deletedAt: true,
          maxTotalSizeBytes: true,
          maxFileCount: true,
          maxAlbumCount: true,
          createdAt: true,
        },
      }),
      this.prisma.media.groupBy({
        by: ['ownerId'],
        where: { isArchived: false },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.album.groupBy({
        by: ['ownerId'],
        _count: { _all: true },
      }),
    ]);

    const mediaByOwner = new Map(
      mediaStats.map((entry) => [
        entry.ownerId,
        {
          fileCount: Number(entry._count._all ?? 0),
          totalSizeBytes: Number(entry._sum.sizeBytes ?? 0),
        },
      ]),
    );

    const albumByOwner = new Map(
      albumStats.map((entry) => [entry.ownerId, Number(entry._count._all ?? 0)]),
    );

    return users.map((user) => {
      const media = mediaByOwner.get(user.id) || {
        fileCount: 0,
        totalSizeBytes: 0,
      };
      const albumCount = albumByOwner.get(user.id) ?? 0;
      return {
        ...user,
        fileCount: media.fileCount,
        albumCount,
        totalSizeBytes: media.totalSizeBytes,
      };
    });
  }

  async updateUserLimits(
    requesterId: string,
    userId: string,
    limits: {
      maxTotalSizeBytes?: number | null;
      maxFileCount?: number | null;
      maxAlbumCount?: number | null;
    },
  ) {
    await this.ensureAdmin(requesterId);

    const data: {
      maxTotalSizeBytes?: number | null;
      maxFileCount?: number | null;
      maxAlbumCount?: number | null;
    } = {};

    if ('maxTotalSizeBytes' in limits) {
      data.maxTotalSizeBytes = this.normalizeLimit(
        limits.maxTotalSizeBytes,
        'maxTotalSizeBytes',
      );
    }
    if ('maxFileCount' in limits) {
      data.maxFileCount = this.normalizeLimit(limits.maxFileCount, 'maxFileCount');
    }
    if ('maxAlbumCount' in limits) {
      data.maxAlbumCount = this.normalizeLimit(
        limits.maxAlbumCount,
        'maxAlbumCount',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    const [user, mediaAggregate, albumCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          isAdmin: true,
          isFrozen: true,
          deletedAt: true,
          maxTotalSizeBytes: true,
          maxFileCount: true,
          maxAlbumCount: true,
          createdAt: true,
        },
      }),
      this.prisma.media.aggregate({
        where: { ownerId: userId, isArchived: false },
        _count: { id: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.album.count({ where: { ownerId: userId } }),
    ]);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      ...user,
      fileCount: Number(mediaAggregate._count.id ?? 0),
      albumCount: Number(albumCount),
      totalSizeBytes: Number(mediaAggregate._sum.sizeBytes ?? 0),
    };
  }

  async setUserFrozen(requesterId: string, userId: string, frozen: boolean) {
    await this.ensureAdmin(requesterId);

    if (requesterId === userId) {
      throw new BadRequestException('Admin cannot freeze own account');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!target) {
      throw new BadRequestException('User not found');
    }

    if (target.deletedAt) {
      throw new BadRequestException('Deleted account cannot be frozen');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isFrozen: Boolean(frozen) },
    });

    return this.adminUsers(requesterId);
  }

  async removeUser(
    requesterId: string,
    userId: string,
    mode: 'delete-files' | 'archive-files',
  ) {
    await this.ensureAdmin(requesterId);

    if (requesterId === userId) {
      throw new BadRequestException('Admin cannot delete own account');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        isAdmin: true,
        deletedAt: true,
      },
    });

    if (!targetUser) {
      throw new BadRequestException('User not found');
    }

    if (targetUser.deletedAt) {
      throw new BadRequestException('Account already deleted');
    }

    if (targetUser.isAdmin) {
      const adminsCount = await this.prisma.user.count({
        where: { isAdmin: true, deletedAt: null },
      });
      if (adminsCount <= 1) {
        throw new BadRequestException('Cannot delete the last active admin');
      }
    }

    const mediaItems = await this.prisma.media.findMany({
      where: { ownerId: userId },
      select: { id: true, filePath: true },
    });
    const mediaIds = mediaItems.map((item) => item.id);
    const mediaFilePaths = mediaItems.map((item) => item.filePath);

    const revisions = mediaIds.length
      ? await this.prisma.mediaRevision.findMany({
          where: { mediaId: { in: mediaIds } },
          select: { filePath: true },
        })
      : [];
    const revisionPaths = revisions.map((item) => item.filePath);

    const replacementPasswordHash = await bcrypt.hash(randomUUID(), 10);

    if (mode === 'delete-files') {
      await this.prisma.$transaction(async (tx) => {
        if (mediaIds.length > 0) {
          await tx.mediaTag.deleteMany({ where: { mediaId: { in: mediaIds } } });
          await tx.albumMedia.deleteMany({ where: { mediaId: { in: mediaIds } } });
          await tx.mediaRevision.deleteMany({ where: { mediaId: { in: mediaIds } } });
          await tx.media.deleteMany({ where: { id: { in: mediaIds } } });
        }

        await tx.publicShareAccess.deleteMany({ where: { ownerId: userId } });
        await tx.album.deleteMany({ where: { ownerId: userId } });
        await tx.tag.deleteMany({ where: { ownerId: userId } });
        await tx.user.update({
          where: { id: userId },
          data: {
            isFrozen: true,
            deletedAt: new Date(),
            passwordHash: replacementPasswordHash,
          },
        });
      });

      await this.deleteObjectsFromR2(userId, [...mediaFilePaths, ...revisionPaths]);
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.publicShareAccess.deleteMany({ where: { ownerId: userId } });

        if (mediaIds.length > 0) {
          await tx.media.updateMany({
            where: { id: { in: mediaIds } },
            data: {
              isArchived: true,
              archivedAt: new Date(),
              archivedFromOwnerId: userId,
              archivedFromDisplayName: targetUser.displayName || null,
              archivedFromEmail: targetUser.email,
            },
          });

          await tx.albumMedia.deleteMany({ where: { mediaId: { in: mediaIds } } });
          await tx.mediaTag.deleteMany({ where: { mediaId: { in: mediaIds } } });
        }

        await tx.album.deleteMany({ where: { ownerId: userId } });
        await tx.tag.deleteMany({ where: { ownerId: userId } });

        await tx.user.update({
          where: { id: userId },
          data: {
            isFrozen: true,
            deletedAt: new Date(),
            passwordHash: replacementPasswordHash,
          },
        });
      });
    }

    return this.adminUsers(requesterId);
  }

  async adminArchiveMedia(requesterId: string) {
    await this.ensureAdmin(requesterId);

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

  async stats(userId: string) {
    const [fileCount, albumCount, aggregate] = await Promise.all([
      this.prisma.media.count({ where: { ownerId: userId, isArchived: false } }),
      this.prisma.album.count({ where: { ownerId: userId } }),
      this.prisma.media.aggregate({
        where: { ownerId: userId, isArchived: false },
        _sum: { sizeBytes: true },
      }),
    ]);

    const dbTotalSizeBytes = Number(aggregate._sum.sizeBytes ?? 0);

    const totalSizeBytes = dbTotalSizeBytes;
    const hasDbStats = fileCount > 0 || albumCount > 0 || dbTotalSizeBytes > 0;

    return {
      fileCount,
      albumCount,
      totalSizeBytes,
      dbTotalSizeBytes,
      storageTotalSizeBytes: null,
      statsSource: 'db',
      isBackfilled: hasDbStats,
    };
  }

  private normalizeLimit(value: number | null | undefined, field: string) {
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`${field} must be a non-negative number or null`);
    }
    return Math.round(value);
  }

  private async ensureAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isAdmin: true, isFrozen: true, deletedAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.deletedAt) {
      throw new ForbiddenException('Account was deleted');
    }

    if (user.isFrozen) {
      throw new ForbiddenException('Account is frozen');
    }

    if (!user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
  }

  private async issueToken(
    id: string,
    email: string,
    displayName: string | null,
    isAdmin: boolean,
  ) {
    const accessToken = await this.jwtService.signAsync({
      sub: id,
      email,
      displayName,
      isAdmin,
    });

    return {
      accessToken,
      user: {
        id,
        email,
        displayName,
        isAdmin,
      },
    };
  }
}
