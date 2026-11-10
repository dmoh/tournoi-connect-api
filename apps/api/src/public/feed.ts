/** Une carte sponsorisée au plus pour quatre éléments du fil (revue des appels à l'action). */
export const POSTS_BETWEEN_SPONSORED = 3;

export interface FeedSponsor {
  id: string;
  tier: 'GOLD' | 'SILVER' | 'BRONZE' | 'FIELD';
}

export type FeedItem<P, S> =
  { type: 'post'; post: P } | { type: 'sponsored'; sponsor: S };

const TIER_ORDER: Record<FeedSponsor['tier'], number> = {
  GOLD: 0,
  SILVER: 1,
  BRONZE: 2,
  FIELD: 3,
};

/**
 * Compose le fil News : après chaque bloc de trois posts, une carte
 * sponsorisée, en tournant sur les sponsors payés (Or d'abord). Jamais de
 * carte sponsorisée en tête ni deux à la suite.
 */
export function composeFeed<P, S extends FeedSponsor>(
  posts: readonly P[],
  sponsors: readonly S[],
): FeedItem<P, S>[] {
  const ordered = [...sponsors].sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.id.localeCompare(b.id),
  );
  const feed: FeedItem<P, S>[] = [];
  let next = 0;
  posts.forEach((post, index) => {
    feed.push({ type: 'post', post });
    const endOfBlock = (index + 1) % POSTS_BETWEEN_SPONSORED === 0;
    const sponsor = ordered[next % Math.max(ordered.length, 1)];
    if (endOfBlock && sponsor && index < posts.length - 1) {
      feed.push({ type: 'sponsored', sponsor });
      next += 1;
    }
  });
  return feed;
}
