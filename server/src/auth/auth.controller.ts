import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  @Post('register')
  register(
    @Body()
    body: {
      email: string;
      password: string;
      displayName?: string;
    },
  ) {
    return this.authService.register(body.email, body.password, body.displayName);
  }

  @Post('login')
  login(
    @Body()
    body: {
      email: string;
      password: string;
    },
  ) {
    return this.authService.login(body.email, body.password);
  }

  @Post('admin/login')
  adminLogin(
    @Body()
    body: {
      email: string;
      password: string;
    },
  ) {
    return this.authService.adminLogin(body.email, body.password);
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const userId = await this.resolveUserIdFromAuthorization(authorization);
    const user = await this.authService.me(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }

  @Get('stats')
  async stats(@Headers('authorization') authorization?: string) {
    const userId = await this.resolveUserIdFromAuthorization(authorization);
    return this.authService.stats(userId);
  }

  @Get('admin/users')
  async adminUsers(@Headers('authorization') authorization?: string) {
    const userId = await this.resolveUserIdFromAuthorization(authorization);
    return this.authService.adminUsers(userId);
  }

  @Post('admin/users/:id/limits')
  async updateUserLimits(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      maxTotalSizeBytes?: number | null;
      maxFileCount?: number | null;
      maxAlbumCount?: number | null;
    },
  ) {
    const requesterId = await this.resolveUserIdFromAuthorization(authorization);
    return this.authService.updateUserLimits(requesterId, id, {
      maxTotalSizeBytes: body.maxTotalSizeBytes,
      maxFileCount: body.maxFileCount,
      maxAlbumCount: body.maxAlbumCount,
    });
  }

  private async resolveUserIdFromAuthorization(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
