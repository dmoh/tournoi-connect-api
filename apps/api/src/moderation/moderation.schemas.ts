import { z } from 'zod';

export const reportReasonSchema = z.enum([
  'ILLEGAL',
  'ABUSE',
  'PRIVACY',
  'SPAM',
  'OTHER',
]);

/** Signalement d'une page de tournoi ou de l'une de ses actualités. */
export const createReportSchema = z.object({
  /** Actualité signalée ; absent : la page du tournoi. */
  postId: z.string().min(1).max(40).optional(),
  reason: reportReasonSchema,
  details: z.string().trim().max(1000).default(''),
  /** Pour être recontacté (facultatif). */
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email().max(254))
    .optional(),
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
});

export const reportListQuerySchema = z.object({
  status: z.enum(['OPEN', 'HIDDEN', 'DISMISSED']).default('OPEN'),
});

export type CreateReport = z.infer<typeof createReportSchema>;
export type PlatformReport = z.infer<typeof platformReportSchema>;
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;
