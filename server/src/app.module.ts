import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MediaModule } from './media/media.module';
import { TagsModule } from './tags/tags.module';
import { AlbumsModule } from './albums/albums.module';

@Module({
  imports: [PrismaModule, AuthModule, MediaModule, TagsModule, AlbumsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
