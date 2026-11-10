import type { Phase } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { TournamentSummary } from './public.schemas.js';

/** Tournoi chargé avec son lieu et son organisation. */
export type TournamentWithVenue = Prisma.TournamentGetPayload<{
  include: { venue: true; organization: true };
}>;

/** Statuts visibles du public : un tournoi publié, en cours ou terminé. */
export const PUBLIC_STATUSES = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;

/** Statuts de la découverte : en cours ou à venir. */
export const DISCOVERABLE_STATUSES = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
] as const;

/** round_of_32 (identifiant Prisma) ↔ round-of-32 (contrat). */
export function toPublicPhase(
  phase: Phase,
): 'groups' | 'round-of-32' | 'round-of-16' | 'quarter' | 'semi' | 'final' {
  return phase.replaceAll('_', '-') as ReturnType<typeof toPublicPhase>;
}

/** Date ISO avec le décalage de Paris, comme les données de la PWA. */
export function toIso(date: Date): string {
  return date.toISOString();
}

export function toSummary(t: TournamentWithVenue): TournamentSummary {
  return {
    slug: t.slug,
    name: t.name,
    sport: t.sport,
    organizer: t.organization.name,
    startsAt: toIso(t.startsAt),
    endsAt: toIso(t.endsAt),
    venue: {
      name: t.venue.name,
      city: t.venue.city,
      lat: t.venue.lat,
      lng: t.venue.lng,
      outdoor: t.venue.outdoor,
    },
    categories: t.categories,
    teamCount: t.teamCount,
    maxTeams: t.maxTeams,
    feeCents: t.feeCents,
    status: t.status as TournamentSummary['status'],
  };
}
