import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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
    const [fileCount, aggregate] = await Promise.all([
      this.prisma.media.count({ where: { ownerId: userId } }),
      this.prisma.media.aggregate({
        where: { ownerId: userId },
        _sum: { sizeBytes: true },
      }),
    ]);

    return {
      fileCount,
      totalSizeBytes: aggregate._sum.sizeBytes ?? 0,
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
