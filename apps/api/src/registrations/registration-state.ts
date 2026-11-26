import type { PrismaService } from '../database/prisma.service.js';
import type {
  Prisma,
  Registration,
  Tournament,
} from '../generated/prisma/client.js';
import { shortName, teamCodeBase } from './pricing.js';
import type {
  CancellationView,
  RegistrationView,
} from './registrations.schemas.js';

type Tx = Prisma.TransactionClient;
type StoredPlayer = { firstName: string; lastName: string; number: string };

export const EURO_FORMAT = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

export const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Inscriptions ouvertes : statut, et clôture jusqu'à la fin du jour indiqué. */
export function registrationOpen(
  tournament: Pick<Tournament, 'status' | 'registrationDeadline'>,
  now: Date,
): boolean {
  if (tournament.status !== 'REGISTRATION_OPEN') {
    return false;
  }
  return (
    !tournament.registrationDeadline ||
    now.getTime() <
      tournament.registrationDeadline.getTime() + 24 * 60 * 60 * 1000
  );
}

/** Annulation par le club, telle que le responsable et le club la lisent. */
export function cancellationView(
  r: Pick<
    Registration,
    'cancellation' | 'cancelledAt' | 'refundCents' | 'refundedAt'
  >,
): { cancellation?: CancellationView } {
  if (!r.cancellation || !r.cancelledAt) {
    return {};
  }
  return {
    cancellation: {
      kind: r.cancellation,
      at: r.cancelledAt.toISOString(),
      refundCents: r.refundCents ?? 0,
      refundedAt: r.refundedAt?.toISOString() ?? null,
    },
  };
}

/** Ce qu'il faut d'une inscription pour savoir si elle tient une place. */
export type HoldFields = Pick<
  Registration,
  'status' | 'expiresAt' | 'paymentDueAt'
>;

/**
 * Une inscription en attente de paiement tient sa place tant que sa page de
 * paiement est ouverte (`expiresAt`) ou que la place proposée depuis la liste
 * d'attente n'est pas échue (`paymentDueAt`). Au-delà, elle s'affiche
 * EXPIRED avant même que le worker ne l'écrive.
 */
export function holdsPlace(r: HoldFields, now: Date): boolean {
  return (
    r.status === 'PENDING_PAYMENT' &&
    ((r.expiresAt !== null && r.expiresAt > now) ||
      (r.paymentDueAt !== null && r.paymentDueAt > now))
  );
}

/** Statut affiché : un paiement en attente dont la place est rendue vaut EXPIRED. */
export function displayedStatus(
  r: HoldFields,
  now: Date,
): RegistrationView['status'] {
  return r.status === 'PENDING_PAYMENT' && !holdsPlace(r, now)
    ? 'EXPIRED'
    : r.status;
}

/** Filtre Prisma des paiements en attente qui tiennent encore leur place. */
export function holdingWhere(now: Date): Prisma.RegistrationWhereInput {
  return {
    status: 'PENDING_PAYMENT',
    OR: [{ expiresAt: { gt: now } }, { paymentDueAt: { gt: now } }],
  };
}

/** Filtre Prisma des paiements en attente dont la place est rendue (affichés EXPIRED). */
export function lapsedWhere(now: Date): Prisma.RegistrationWhereInput {
  return {
    status: 'PENDING_PAYMENT',
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { lte: now } }] },
      { OR: [{ paymentDueAt: null }, { paymentDueAt: { lte: now } }] },
    ],
  };
}

/** Places prises : équipes inscrites et places tenues (sauf `excludeId`). */
export async function occupiedPlaces(
  db: Tx | PrismaService,
  tournament: Pick<Tournament, 'id' | 'teamCount'>,
  now: Date,
  excludeId?: string,
): Promise<number> {
  const holding = await db.registration.count({
    where: {
      tournamentId: tournament.id,
      ...holdingWhere(now),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  return tournament.teamCount + holding;
}

/**
 * Crée l'équipe d'une inscription confirmée (code unique, effectif
 * renuméroté) et compte la place ; à appeler sous le verrou du tournoi.
 */
export async function createTeam(
  tx: Tx,
  tournament: Tournament,
  registration: Registration,
): Promise<void> {
  const base = teamCodeBase(registration.teamName);
  const taken = new Set(
    (
      await tx.team.findMany({
        where: { tournamentId: tournament.id, code: { startsWith: base } },
        select: { code: true },
      })
    ).map((t) => t.code),
  );
  let code = base;
  for (let n = 2; taken.has(code); n += 1) {
    code = `${base}${n}`;
  }
  const players = (registration.players as StoredPlayer[]).map((p, i) => ({
    number: Number(p.number) || i + 1,
    name: `${p.firstName} ${p.lastName}`.trim(),
  }));
  // Numéros en double ou absents : renumérotés à la suite.
  const used = new Set<number>();
  const unique = players.map((p) => {
    let number = p.number;
    while (used.has(number)) {
      number += 100;
    }
    used.add(number);
    return { ...p, number };
  });
  const team = await tx.team.create({
    data: {
      tournamentId: tournament.id,
      code,
      name: registration.teamName,
      shortName: shortName(registration.teamName),
      club: registration.club || registration.teamName,
      players: { create: unique },
    },
  });
  await tx.registration.update({
    where: { id: registration.id },
    data: { teamId: team.id },
  });
  await tx.tournament.update({
    where: { id: tournament.id },
    data: { teamCount: { increment: 1 } },
  });
}
