/** Événement du fil tel qu'enregistré (insertion seule). */
export interface StoredEvent {
  id: string;
  type:
    | 'GOAL'
    | 'YELLOW_CARD'
    | 'RED_CARD'
    | 'SAVE'
    | 'PHOTO'
    | 'HALF_TIME'
    | 'FULL_TIME'
    | 'CANCEL';
  side: 'HOME' | 'AWAY' | null;
  minute: number;
  player: string | null;
  assist: string | null;
  caption: string | null;
  cancelsId: string | null;
}

/** Événement affiché au spectateur, avec le score juste après lui. */
export interface FeedEvent {
  id: string;
  type: Exclude<StoredEvent['type'], 'CANCEL'>;
  side?: 'home' | 'away';
  minute: number;
  player?: string;
  assist?: string;
  caption?: string;
  score: { home: number; away: number };
}

/**
 * Rejoue le fil dans l'ordre d'enregistrement : les événements annulés
 * disparaissent, chaque but compte pour son camp, et chaque ligne porte le
 * score atteint (« FC Annemasse · 1 – 1 », « Mi-temps · 1 – 0 »).
 * Renvoie le plus récent en premier, comme le fil de la maquette 11.
 */
export function replayFeed(events: readonly StoredEvent[]): FeedEvent[] {
  const cancelled = new Set(
    events
      .filter((e) => e.type === 'CANCEL' && e.cancelsId)
      .map((e) => e.cancelsId),
  );
  const score = { home: 0, away: 0 };
  const feed: FeedEvent[] = [];
  for (const event of events) {
    if (event.type === 'CANCEL' || cancelled.has(event.id)) {
      continue;
    }
    const side =
      event.side === 'HOME'
        ? 'home'
        : event.side === 'AWAY'
          ? 'away'
          : undefined;
    if (event.type === 'GOAL' && side) {
      score[side] += 1;
    }
    feed.push({
      id: event.id,
      type: event.type,
      ...(side ? { side } : {}),
      minute: event.minute,
      ...(event.player ? { player: event.player } : {}),
      ...(event.assist ? { assist: event.assist } : {}),
      ...(event.caption ? { caption: event.caption } : {}),
      score: { ...score },
    });
  }
  return feed.reverse();
}
