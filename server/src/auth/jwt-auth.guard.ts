import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export type RequestWithUser = Request & {
  user?: {
    id: string;
    email?: string;
    displayName?: string | null;
    isAdmin?: boolean;
  };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser & { query: Record<string, string> }>();
    const authHeader = request.headers['authorization'];

    // Accept JWT either from Authorization header or ?token= query param
    // (query param is needed for <video src> / <audio src> which can't send headers)
    const rawToken =
      (typeof authHeader === 'string' ? authHeader.replace('Bearer ', '').trim() : '') ||
      (typeof request.query.token === 'string' ? request.query.token.trim() : '');

    if (!rawToken) {
      throw new UnauthorizedException('Missing token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        displayName: string | null;
        isAdmin?: boolean;
      }>(rawToken);
      request.user = {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName,
        isAdmin: Boolean(payload.isAdmin),
      };

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isFrozen: true, deletedAt: true },
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

      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
