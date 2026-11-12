import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  keyset,
  pageQuerySchema,
  seekAfter,
  takePage,
  type Direction,
} from './pagination.js';

interface Row {
  id: string;
  createdAt: Date;
}

type Cmp = { lt?: unknown; gt?: unknown };

/** Évalue en mémoire le filtre « après le curseur » produit pour Prisma. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  const or = where['OR'] as Record<string, unknown>[] | undefined;
  if (!or) {
    return true;
  }
  const value = (field: string) => {
    const v = row[field as keyof Row];
    return v instanceof Date ? v.getTime() : v;
  };
  const norm = (v: unknown) => (v instanceof Date ? v.getTime() : v);
  return or.some((branch) =>
    Object.entries(branch).every(([field, condition]) => {
      const actual = value(field) as string | number;
      if (condition instanceof Date || typeof condition !== 'object') {
        return actual === norm(condition);
      }
      const { lt, gt } = condition as Cmp;
      if (lt !== undefined) {
        return actual < (norm(lt) as string | number);
      }
      return actual > (norm(gt) as string | number);
    }),
  );
}

/** Lit toute la liste page par page, comme le ferait la PWA. */
function readAll(rows: Row[], direction: Direction, limit: number) {
  const sign = direction === 'asc' ? 1 : -1;
  const sorted = [...rows].sort(
    (a, b) =>
      sign * (a.createdAt.getTime() - b.createdAt.getTime()) ||
      sign * a.id.localeCompare(b.id),
  );
  const pages: string[][] = [];
  let cursor: string | undefined;
  do {
    const page = keyset(
      { scope: 'test', key: 'createdAt', kind: 'date', direction },
      { limit, ...(cursor ? { cursor } : {}) },
    );
    const read = sorted
      .filter((row) => matches(row, page.where))
      .slice(0, page.take);
    const result = page.finish(read, (row) => row.id);
    pages.push(result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor && pages.length < 100);
  return { sorted: sorted.map((r) => r.id), pages };
}

describe('pagination par curseur', () => {
  const at = (iso: string) => new Date(iso);
  // Trois lignes de la même milliseconde : seul l'identifiant les départage.
  const rows: Row[] = [
    { id: 'c', createdAt: at('2026-11-09T10:00:00.000Z') },
    { id: 'a', createdAt: at('2026-11-09T10:00:00.000Z') },
    { id: 'e', createdAt: at('2026-11-09T09:00:00.000Z') },
    { id: 'b', createdAt: at('2026-11-09T10:00:00.000Z') },
    { id: 'd', createdAt: at('2026-11-09T11:00:00.000Z') },
  ];

  it('rend chaque ligne une fois, dates égales départagées par id', () => {
    for (const direction of ['asc', 'desc'] as const) {
      for (const limit of [1, 2, 3, 5, 50]) {
        const { sorted, pages } = readAll(rows, direction, limit);
        expect(pages.flat()).toEqual(sorted);
        expect(pages.at(-1)!.length).toBeGreaterThan(0);
      }
    }
    expect(readAll(rows, 'desc', 2).pages).toEqual([
      ['d', 'c'],
      ['b', 'a'],
      ['e'],
    ]);
  });

  it('rend nextCursor null sur la dernière page', () => {
    const exact = takePage([1, 2], 2, String);
    expect(exact).toEqual({ rows: [1, 2], nextCursor: null });
    const more = takePage([1, 2, 3], 2, String);
    expect(more).toEqual({ rows: [1, 2], nextCursor: '2' });
    expect(takePage([], 20, String)).toEqual({ rows: [], nextCursor: null });
  });

  it('fait l’aller-retour du curseur', () => {
    const tuple = z.tuple([z.number(), z.iso.datetime(), z.string()]);
    const cursor = encodeCursor('explorer', [
      0.123456789012345,
      '2026-11-09T10:00:00.000Z',
      'x1',
    ]);
    expect(cursor).toMatch(/^[\w-]+$/);
    expect(decodeCursor(cursor, 'explorer', tuple)).toEqual([
      0.123456789012345,
      '2026-11-09T10:00:00.000Z',
      'x1',
    ]);
  });

  it('refuse un curseur falsifié, d’une autre liste ou mal formé (400)', () => {
    const tuple = z.tuple([z.iso.datetime(), z.string()]);
    const valid = encodeCursor('news', ['2026-11-09T10:00:00.000Z', 'p1']);
    const bad = [
      'pas-du-base64',
      Buffer.from('{"a":1}').toString('base64url'),
      encodeCursor('registrations', ['2026-11-09T10:00:00.000Z', 'p1']),
      encodeCursor('news', ['hier', 'p1']),
      encodeCursor('news', ['2026-11-09T10:00:00.000Z']),
      valid.slice(0, -3),
    ];
    for (const cursor of bad) {
      expect(() => decodeCursor(cursor, 'news', tuple)).toThrow(
        BadRequestException,
      );
    }
    expect(() =>
      keyset(
        { scope: 'news', key: 'publishedAt', kind: 'date', direction: 'desc' },
        { cursor: encodeCursor('news', ['Zoé', 'p1']), limit: 20 },
      ),
    ).toThrow(BadRequestException);
  });

  it('borne la limite entre 1 et 50, 20 par défaut', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE });
    expect(pageQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    for (const limit of ['0', '51', '-1', '2.5', 'abc']) {
      expect(pageQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(pageQuerySchema.safeParse({ cursor: 'a b' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ cursor: 'a'.repeat(513) }).success).toBe(
      false,
    );
  });

  it('demande une ligne de plus que la page, triée sur (clé, id)', () => {
    const page = keyset(
      {
        scope: 'members',
        key: 'teamName',
        kind: 'text',
        direction: 'asc',
        idKey: 'userId',
      },
      { cursor: encodeCursor('members', ['Arve', 'u1']), limit: 25 },
    );
    expect(page.take).toBe(26);
    expect(page.orderBy).toEqual([{ teamName: 'asc' }, { userId: 'asc' }]);
    expect(page.where).toEqual({
      OR: [
        { teamName: { gt: 'Arve' } },
        { teamName: 'Arve', userId: { gt: 'u1' } },
      ],
    });
    expect(seekAfter('createdAt', 'id', 'desc', null)).toEqual({});
  });
});
