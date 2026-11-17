import type { PlannedMatch } from './bracket.js';

export interface ScheduleInput {
  /** Début du premier match (millisecondes depuis l'époque). */
  startsAt: number;
  fields: number;
  matchMinutes: number;
  /** Battement entre deux créneaux d'un même terrain. */
  breakMinutes: number;
}

export interface ScheduledMatch extends PlannedMatch {
  /** « Terrain 1 », « Terrain 2 »… */
  field: string;
  startsAt: number;
}

/**
 * Horaires et terrains : créneaux successifs de match + battement, tous les
 * terrains en parallèle. Une équipe ne joue jamais deux matchs dans le même
 * créneau ; un match du tableau attend la fin des matchs dont il dépend
 * (toute la poule pour un qualifié). Les matchs gardent l'ordre des journées.
 * Fonction pure et déterministe.
 */
export function scheduleMatches(
  matches: readonly PlannedMatch[],
  input: ScheduleInput,
): ScheduledMatch[] {
  const fields = Math.max(1, input.fields);
  const slotMs = (input.matchMinutes + input.breakMinutes) * 60_000;
  const used = new Map<number, number>();
  const busy = new Map<number, Set<string>>();
  const slotOf = new Map<string, number>();
  const groupEnd = new Map<string, number>();

  const ordered = [...matches].sort(
    (a, b) =>
      a.round - b.round ||
      (a.group ?? '~').localeCompare(b.group ?? '~') ||
      a.code.localeCompare(b.code, 'fr', { numeric: true }),
  );
  const scheduled: ScheduledMatch[] = [];
  for (const match of ordered) {
    let slot = 0;
    for (const source of [match.homeSource, match.awaySource]) {
      if (!source) {
        continue;
      }
      const [kind, ref] = source.split(':');
      const after = kind === 'group' ? groupEnd.get(ref!) : slotOf.get(ref!);
      if (after !== undefined) {
        slot = Math.max(slot, after + 1);
      }
    }
    const teams = [match.homeTeam, match.awayTeam].filter(
      (t): t is string => !!t,
    );
    while (
      (used.get(slot) ?? 0) >= fields ||
      teams.some((team) => busy.get(slot)?.has(team))
    ) {
      slot += 1;
    }
    const field = used.get(slot) ?? 0;
    used.set(slot, field + 1);
    const inSlot = busy.get(slot) ?? new Set<string>();
    teams.forEach((team) => inSlot.add(team));
    busy.set(slot, inSlot);
    slotOf.set(match.code, slot);
    if (match.group) {
      groupEnd.set(match.group, Math.max(groupEnd.get(match.group) ?? 0, slot));
    }
    scheduled.push({
      ...match,
      field: `Terrain ${field + 1}`,
      startsAt: input.startsAt + slot * slotMs,
    });
  }
  return scheduled;
}
