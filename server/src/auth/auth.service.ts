import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

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

  private async getStorageUsageFromR2(ownerId: string) {
    const client = this.getR2Client();
    if (!client) return null;

    let continuationToken: string | undefined;
    let totalSizeBytes = 0;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: r2BucketName,
          Prefix: `${ownerId}/`,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      (response.Contents || []).forEach((entry) => {
        if (typeof entry.Size === 'number' && Number.isFinite(entry.Size)) {
          totalSizeBytes += entry.Size;
        }
      });

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken || undefined
        : undefined;
    } while (continuationToken);

    return {
      totalSizeBytes,
    };
  }

  async register(email: string, password: string, displayName?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userCount = await this.prisma.user.count();

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

    let isAdmin = Boolean(user.isAdmin);
    if (!isAdmin) {
      const adminsCount = await this.prisma.user.count({ where: { isAdmin: true } });
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
          maxTotalSizeBytes: true,
          maxFileCount: true,
          maxAlbumCount: true,
          createdAt: true,
        },
      }),
      this.prisma.media.groupBy({
        by: ['ownerId'],
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
      const media = mediaByOwner.get(user.id) || { fileCount: 0, totalSizeBytes: 0 };
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
      data.maxTotalSizeBytes = this.normalizeLimit(limits.maxTotalSizeBytes, 'maxTotalSizeBytes');
    }
    if ('maxFileCount' in limits) {
      data.maxFileCount = this.normalizeLimit(limits.maxFileCount, 'maxFileCount');
    }
    if ('maxAlbumCount' in limits) {
      data.maxAlbumCount = this.normalizeLimit(limits.maxAlbumCount, 'maxAlbumCount');
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
          maxTotalSizeBytes: true,
          maxFileCount: true,
          maxAlbumCount: true,
          createdAt: true,
        },
      }),
      this.prisma.media.aggregate({
        where: { ownerId: userId },
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

  async stats(userId: string) {
    const [fileCount, albumCount, aggregate] = await Promise.all([
      this.prisma.media.count({ where: { ownerId: userId } }),
      this.prisma.album.count({ where: { ownerId: userId } }),
      this.prisma.media.aggregate({
        where: { ownerId: userId },
        _sum: { sizeBytes: true },
      }),
    ]);

    const dbTotalSizeBytes = Number(aggregate._sum.sizeBytes ?? 0);

    let storageTotalSizeBytes: number | null = null;
    try {
      const storageStats = await this.getStorageUsageFromR2(userId);
      storageTotalSizeBytes = storageStats ? storageStats.totalSizeBytes : null;
    } catch {
      storageTotalSizeBytes = null;
    }

    const hasDbStats = fileCount > 0 || albumCount > 0 || dbTotalSizeBytes > 0;
    const hasStorageStats = typeof storageTotalSizeBytes === 'number';
    const totalSizeBytes = hasStorageStats ? storageTotalSizeBytes : dbTotalSizeBytes;

    return {
      fileCount,
      albumCount,
      totalSizeBytes,
      dbTotalSizeBytes,
      storageTotalSizeBytes,
      statsSource: hasStorageStats ? 'r2' : 'db',
      isBackfilled: hasDbStats || hasStorageStats,
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
      select: { id: true, isAdmin: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
  }

  private async issueToken(id: string, email: string, displayName: string | null, isAdmin: boolean) {
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
