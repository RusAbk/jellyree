import {
  Body,
  Controller,
  Get,
  Headers,
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

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
      const user = await this.authService.me(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      return user;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
