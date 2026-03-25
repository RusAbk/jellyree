import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

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
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing token');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        displayName: string | null;
        isAdmin?: boolean;
      }>(token);
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
