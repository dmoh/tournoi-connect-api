import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { isUniqueViolation } from './prisma-errors.js';
import { insertWithUniqueSlug, SLUG_ATTEMPTS, slugify } from './slug.js';

/** P2002 tel que le lève Prisma 7 avec le pilote pg. */
const unique = (index: string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.1',
    meta: {
      driverAdapterError: {
        cause: { kind: 'UniqueConstraintViolation', constraint: { index } },
      },
    },
  });

describe('slugify', () => {
  it('retire accents et ponctuation', () => {
    expect(slugify('Coupe d’hiver U13 — Élite')).toBe(
      'coupe-d-hiver-u13-elite',
    );
  });
});

describe('isUniqueViolation', () => {
  it('reconnaît le champ dans le nom d’index ou la liste des colonnes', () => {
    expect(isUniqueViolation(unique('tournament_slug_key'), 'slug')).toBe(true);
    expect(isUniqueViolation(unique('membership_pkey'), 'slug')).toBe(false);
    expect(isUniqueViolation(unique('membership_pkey'))).toBe(true);
    expect(
      isUniqueViolation(
        new Prisma.PrismaClientKnownRequestError('x', {
          code: 'P2002',
          clientVersion: '7.10.1',
          meta: { target: ['slug'] },
        }),
        'slug',
      ),
    ).toBe(true);
    expect(isUniqueViolation(new Error('P2002'), 'slug')).toBe(false);
  });
});

describe('insertWithUniqueSlug', () => {
  it('vise d’emblée le premier slug libre', async () => {
    const insert = vi.fn(async (slug: string) => slug);
    await expect(
      insertWithUniqueSlug('coupe', ['coupe', 'coupe-2'], insert),
    ).resolves.toBe('coupe-3');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('réessaie avec le suffixe suivant quand le slug est pris entre-temps', async () => {
    const insert = vi.fn(async (slug: string) => {
      if (slug !== 'coupe-3') {
        throw unique('tournament_slug_key');
      }
      return slug;
    });
    await expect(insertWithUniqueSlug('coupe', [], insert)).resolves.toBe(
      'coupe-3',
    );
    expect(insert.mock.calls.map(([slug]) => slug)).toEqual([
      'coupe',
      'coupe-2',
      'coupe-3',
    ]);
  });

  it('laisse passer les autres erreurs et borne les essais', async () => {
    const other = unique('membership_pkey');
    await expect(
      insertWithUniqueSlug('club', [], () => Promise.reject(other)),
    ).rejects.toBe(other);

    const always = vi.fn(() => Promise.reject(unique('organization_slug_key')));
    await expect(insertWithUniqueSlug('club', [], always)).rejects.toThrow(
      ConflictException,
    );
    expect(always).toHaveBeenCalledTimes(SLUG_ATTEMPTS);
  });
});
