import {
  BadRequestException,
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

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
      },
    });

    return this.issueToken(user.id, user.email, user.displayName);
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

    return this.issueToken(user.id, user.email, user.displayName);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });
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

  private async issueToken(id: string, email: string, displayName: string | null) {
    const accessToken = await this.jwtService.signAsync({
      sub: id,
      email,
      displayName,
    });

    return {
      accessToken,
      user: {
        id,
        email,
        displayName,
      },
    };
  }
}
