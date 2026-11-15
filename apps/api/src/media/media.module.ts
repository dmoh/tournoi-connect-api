import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import { ClubPhotosService } from './club-photos.service.js';
import {
  ClubPhotosController,
  PublicPhotosController,
} from './media.controller.js';
import {
  DisabledMediaStorage,
  MEDIA_STORAGE,
  S3MediaStorage,
} from './media-storage.js';
import { MediaService } from './media.service.js';
import { PublicPhotosService } from './public-photos.service.js';

/** Photos : stockage, envoi, galerie. Global : la table de marque, la modération et le worker s'en servent. */
@Global()
@Module({
  controllers: [ClubPhotosController, PublicPhotosController],
  providers: [
    {
      provide: MEDIA_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const bucket = config.get('MEDIA_BUCKET', { infer: true });
        const publicUrl = config.get('MEDIA_PUBLIC_URL', { infer: true });
        return bucket && publicUrl
          ? S3MediaStorage.create(
              config.get('AWS_REGION', { infer: true }),
              bucket,
              publicUrl,
            )
          : new DisabledMediaStorage();
      },
    },
    MediaService,
    ClubPhotosService,
    PublicPhotosService,
    OrganizerGuard,
  ],
  exports: [MEDIA_STORAGE, MediaService],
})
export class MediaModule {}
