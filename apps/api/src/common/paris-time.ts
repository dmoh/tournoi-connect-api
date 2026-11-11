/** Fuseau des tournois : les heures saisies par l'organisateur sont des heures de Paris. */
export const TOURNAMENT_TIME_ZONE = 'Europe/Paris';

/** Décalage (minutes) du fuseau de Paris à l'instant donné, heure d'été comprise. */
function parisOffsetMinutes(instant: Date): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: TOURNAMENT_TIME_ZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!match) {
    return 0;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * Instant d'une date et d'une heure de Paris (« 2026-04-11 », « 09:00 »),
 * heure d'été et d'hiver comprises.
 */
export function parisDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const asUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  // Deux passes : le décalage dépend de l'instant cherché (changement d'heure).
  const first = asUtc - parisOffsetMinutes(new Date(asUtc)) * 60_000;
  return new Date(asUtc - parisOffsetMinutes(new Date(first)) * 60_000);
}

/** Jour de Paris d'un instant (« 2026-04-11 »). */
export function parisDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TOURNAMENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
