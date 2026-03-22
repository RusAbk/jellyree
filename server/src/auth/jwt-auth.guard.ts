import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

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
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
