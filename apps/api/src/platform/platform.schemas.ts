import { z } from 'zod';

/** Vue d'ensemble de la plateforme : activité et services branchés. */
export const platformOverviewSchema = z.object({
  counts: z.object({
    accounts: z.number().int(),
    clubs: z.number().int(),
    tournaments: z.object({
      published: z.number().int(),
      inProgress: z.number().int(),
      drafts: z.number().int(),
    }),
    confirmedRegistrations: z.number().int(),
    /** Montant payé des inscriptions confirmées, en centimes. */
    paidCents: z.number().int(),
    /** Frais de service perçus par la plateforme, en centimes. */
    serviceFeeCents: z.number().int(),
    openReports: z.number().int(),
    /** Clubs créés par un lien de parrainage. */
    referredClubs: z.number().int(),
  }),
  /** Ce qui manque ici empêche une fonction de marcher en production. */
  services: z.object({
    /** Envoi réel des emails (SES) ; false : simplement journalisés. */
    mail: z.boolean(),
    payments: z.object({
      secretKey: z.boolean(),
      webhook: z.boolean(),
      connectWebhook: z.boolean(),
      /** Clé de test (sk_test_) : aucun vrai paiement. */
      testMode: z.boolean(),
    }),
    push: z.boolean(),
    oauth: z.array(z.enum(['GOOGLE', 'APPLE', 'FACEBOOK'])),
    queues: z.boolean(),
    /** Code fixe des comptes de test : jamais en production. */
    testAccounts: z.boolean(),
  }),
});

export type PlatformOverview = z.infer<typeof platformOverviewSchema>;
