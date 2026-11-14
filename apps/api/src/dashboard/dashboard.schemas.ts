import { z } from 'zod';

const money = z.number().int();

export const dashboardTournamentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  status: z.enum([
    'DRAFT',
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'IN_PROGRESS',
    'COMPLETED',
  ]),
  startsAt: z.iso.datetime({ offset: true }),
  teamCount: z.number().int(),
  maxTeams: z.number().int(),
  registrations: z.object({
    confirmed: z.number().int(),
    /** Paiement en cours (place tenue). */
    pending: z.number().int(),
    waitlisted: z.number().int(),
  }),
  /** Droits d'inscription payés, reversés au club (centimes). */
  collectedCents: money,
  /** Frais de service payés par les équipes à la plateforme. */
  serviceFeeCents: money,
  /** Audience des emplacements sponsorisés du tournoi. */
  audience: z.object({
    impressions: z.number().int(),
    clicks: z.number().int(),
  }),
});

export const dashboardSchema = z.object({
  tournaments: z.array(dashboardTournamentSchema),
  totals: z.object({
    tournaments: z.number().int(),
    teams: z.number().int(),
    collectedCents: money,
    impressions: z.number().int(),
    clicks: z.number().int(),
  }),
  /**
   * Compte Stripe du club : solde et derniers versements vers sa banque ;
   * null si les paiements ne sont pas activés ou si Stripe ne répond pas.
   */
  payouts: z
    .object({
      availableCents: money,
      pendingCents: money,
      recent: z.array(
        z.object({
          amountCents: money,
          arrivalDate: z.iso.datetime({ offset: true }),
          status: z.string(),
        }),
      ),
    })
    .nullable(),
});

export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardTournament = z.infer<typeof dashboardTournamentSchema>;
