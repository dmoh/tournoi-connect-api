import { z } from 'zod';

/** Taille maximale d'une photo, une fois redimensionnée sur l'appareil. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const dimension = z.number().int().min(64).max(4096);
const caption = z.string().trim().min(1).max(140);

/** Demande d'envoi : le fichier est décrit, puis envoyé directement au stockage. */
export const photoUploadRequestSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/webp']),
  bytes: z.number().int().min(1).max(MAX_PHOTO_BYTES),
  width: dimension,
  height: dimension,
  caption: caption.optional(),
  /**
   * La personne qui envoie confirme avoir l'accord des personnes
   * reconnaissables (ou de leurs parents, pour les mineurs).
   */
  consent: z.literal(true, {
    error: 'Confirmez avoir l’accord des personnes photographiées.',
  }),
});

/** Photo du club : peut être rattachée à un match du tournoi. */
export const clubPhotoUploadRequestSchema = photoUploadRequestSchema.extend({
  matchCode: z.string().min(1).max(20).optional(),
});

export const photoUploadSchema = z.object({
  photoId: z.string(),
  /** Envoi par PUT, avec exactement ces en-têtes et la taille annoncée. */
  uploadUrl: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime({ offset: true }),
});

/** Photo publiée, telle que la voient les spectateurs. */
export const publicPhotoSchema = z.object({
  id: z.string(),
  url: z.url(),
  width: z.number().int(),
  height: z.number().int(),
  caption: z.string().nullable(),
  /** Match de la photo (« a5 »), null pour une photo du tournoi. */
  matchCode: z.string().nullable(),
  /** Mise en avant par le club (temps fort du fil). */
  highlight: z.boolean(),
  source: z.enum(['reporter', 'club']),
  createdAt: z.iso.datetime({ offset: true }),
});

export const publicPhotosQuerySchema = z.object({
  match: z.string().min(1).max(20).optional(),
  /** Seulement les temps forts choisis par le club. */
  highlights: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});

/** Photo vue par le club : qui l'a envoyée. */
export const clubPhotoSchema = publicPhotoSchema.extend({
  uploadedBy: z.string().nullable(),
});

export const updatePhotoSchema = z
  .object({
    highlight: z.boolean().optional(),
    caption: caption.nullable().optional(),
  })
  .refine((u) => u.highlight !== undefined || u.caption !== undefined, {
    message: 'Rien à modifier.',
  });

export type PhotoUploadRequest = z.infer<typeof photoUploadRequestSchema>;
export type ClubPhotoUploadRequest = z.infer<
  typeof clubPhotoUploadRequestSchema
>;
export type PhotoUpload = z.infer<typeof photoUploadSchema>;
export type PublicPhoto = z.infer<typeof publicPhotoSchema>;
export type PublicPhotosQuery = z.infer<typeof publicPhotosQuerySchema>;
export type ClubPhoto = z.infer<typeof clubPhotoSchema>;
export type UpdatePhoto = z.infer<typeof updatePhotoSchema>;
