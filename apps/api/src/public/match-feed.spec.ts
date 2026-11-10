import { replayFeed, type StoredEvent } from './match-feed.js';

const event = (
  id: string,
  type: StoredEvent['type'],
  extra: Partial<StoredEvent> = {},
): StoredEvent => ({
  id,
  type,
  side: null,
  minute: 0,
  player: null,
  assist: null,
  caption: null,
  cancelsId: null,
  ...extra,
});

describe('replayFeed', () => {
  it('compte les buts, garde le score de chaque ligne et met le plus récent en tête', () => {
    const feed = replayFeed([
      event('g1', 'GOAL', {
        side: 'HOME',
        minute: 3,
        player: 'L. Martin',
        assist: 'N. Dubois',
      }),
      event('y1', 'YELLOW_CARD', {
        side: 'AWAY',
        minute: 12,
        player: 'N. Dubois',
      }),
      event('ht', 'HALF_TIME', { minute: 25 }),
      event('g2', 'GOAL', { side: 'AWAY', minute: 31, player: 'K. Diallo' }),
    ]);
    expect(feed.map((e) => e.id)).toEqual(['g2', 'ht', 'y1', 'g1']);
    expect(feed[0]).toEqual({
      id: 'g2',
      type: 'GOAL',
      side: 'away',
      minute: 31,
      player: 'K. Diallo',
      score: { home: 1, away: 1 },
    });
    expect(feed[1]?.score).toEqual({ home: 1, away: 0 });
    expect(feed[3]).toMatchObject({
      assist: 'N. Dubois',
      score: { home: 1, away: 0 },
    });
  });

  it('retire un but annulé et l’événement d’annulation', () => {
    const feed = replayFeed([
      event('g1', 'GOAL', { side: 'HOME', minute: 3 }),
      event('g2', 'GOAL', { side: 'HOME', minute: 5 }),
      event('c1', 'CANCEL', { cancelsId: 'g2', minute: 6 }),
      event('g3', 'GOAL', { side: 'AWAY', minute: 9 }),
    ]);
    expect(feed.map((e) => e.id)).toEqual(['g3', 'g1']);
    expect(feed[0]?.score).toEqual({ home: 1, away: 1 });
  });
});
