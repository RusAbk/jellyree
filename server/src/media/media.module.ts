import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { PublicShareController } from './public-share.controller';

@Module({
  controllers: [MediaController, PublicShareController],
})
export class MediaModule {}
