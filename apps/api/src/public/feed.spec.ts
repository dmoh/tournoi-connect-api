import { composeFeed, type FeedSponsor } from './feed.js';

const posts = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
const sponsors: FeedSponsor[] = [
  { id: 'bronze', tier: 'BRONZE' },
  { id: 'or', tier: 'GOLD' },
];

const shape = (feed: ReturnType<typeof composeFeed<string, FeedSponsor>>) =>
  feed.map((item) =>
    item.type === 'post' ? item.post : `[${item.sponsor.id}]`,
  );

describe('composeFeed', () => {
  it('insère une carte sponsorisée après chaque bloc de trois posts, Or d’abord', () => {
    expect(shape(composeFeed(posts, sponsors))).toEqual([
      'p1',
      'p2',
      'p3',
      '[or]',
      'p4',
      'p5',
      'p6',
      '[bronze]',
      'p7',
    ]);
  });

  it('ne termine jamais le fil par une carte sponsorisée', () => {
    expect(shape(composeFeed(['p1', 'p2', 'p3'], sponsors))).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('respecte au plus une carte pour quatre éléments', () => {
    const feed = composeFeed(
      Array.from({ length: 40 }, (_, i) => `p${i}`),
      sponsors,
    );
    for (let start = 0; start + 4 <= feed.length; start += 1) {
      const window = feed.slice(start, start + 4);
      expect(
        window.filter((item) => item.type === 'sponsored').length,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('reprend la rotation des sponsors à la page suivante', () => {
    // Page précédente : une carte (Or) déjà montrée ; celle-ci commence par Bronze.
    expect(shape(composeFeed(posts, sponsors, 1))).toEqual([
      'p1',
      'p2',
      'p3',
      '[bronze]',
      'p4',
      'p5',
      'p6',
      '[or]',
      'p7',
    ]);
  });

  it('se passe de sponsors', () => {
    expect(shape(composeFeed(posts, []))).toEqual(posts);
  });
});
