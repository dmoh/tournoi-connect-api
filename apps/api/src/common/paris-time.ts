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

/** Jour de Paris d'un instant (« 2026-04-11 »), assemblé pièce par pièce (format de locale non garanti). */
export function parisDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TOURNAMENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Heure de Paris d'un instant (« 09:30 »). */
export function parisTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TOURNAMENT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/** Jour décalé de `days` jours (« 2026-11-09 » + 364 → « 2027-11-08 »). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * Jour de l'édition suivante : 52 semaines plus tard, le même jour de la
 * semaine ; 53 si l'on resterait dans la même année (tournoi du 1er ou du
 * 2 janvier).
 */
export function nextEditionDate(date: string): string {
  const next = addDays(date, 52 * 7);
  return next.slice(0, 4) === date.slice(0, 4) ? addDays(date, 53 * 7) : next;
}
