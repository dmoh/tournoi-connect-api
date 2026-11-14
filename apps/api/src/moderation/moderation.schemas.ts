import { z } from 'zod';

export const reportReasonSchema = z.enum([
  'ILLEGAL',
  'ABUSE',
  'PRIVACY',
  'SPAM',
  'OTHER',
]);

/** Signalement d'une page de tournoi, d'une de ses actualités ou photos. */
export const createReportSchema = z
  .object({
    /** Actualité signalée ; absent (avec photoId) : la page du tournoi. */
    postId: z.string().min(1).max(40).optional(),
    /** Photo signalée. */
    photoId: z.string().min(1).max(40).optional(),
    reason: reportReasonSchema,
    details: z.string().trim().max(1000).default(''),
    /** Pour être recontacté (facultatif). */
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email().max(254))
      .optional(),
  })
  .refine((r) => !(r.postId && r.photoId), {
    message: 'Signalez une actualité ou une photo, pas les deux.',
    path: ['photoId'],
  });

export const reportCreatedSchema = z.object({ id: z.string() });

export const platformReportSchema = z.object({
  id: z.string(),
  status: z.enum(['OPEN', 'HIDDEN', 'DISMISSED']),
  reason: reportReasonSchema,
  details: z.string(),
  contactEmail: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  tournament: z.object({
    slug: z.string(),
    name: z.string(),
    organization: z.string(),
    hidden: z.boolean(),
  }),
  /** Actualité signalée, ou null pour la page du tournoi. */
  post: z
    .object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      hidden: z.boolean(),
    })
    .nullable(),
  /** Photo signalée ; url null une fois l'objet effacé. */
  photo: z
    .object({
      id: z.string(),
      url: z.url().nullable(),
      caption: z.string().nullable(),
      hidden: z.boolean(),
    })
    .nullable(),
});

export const reportListQuerySchema = z.object({
  status: z.enum(['OPEN', 'HIDDEN', 'DISMISSED']).default('OPEN'),
});

export type CreateReport = z.infer<typeof createReportSchema>;
export type PlatformReport = z.infer<typeof platformReportSchema>;
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;
