import { ConflictException } from '@nestjs/common';
import { isUniqueViolation } from './prisma-errors.js';

/** « Coupe d'hiver U13 » → « coupe-d-hiver-u13 ». */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Tentatives d'insertion avant d'abandonner (créations simultanées du même nom). */
export const SLUG_ATTEMPTS = 10;

/**
 * Insère avec le premier slug libre (`base`, `base-2`, `base-3`…). Les slugs
 * déjà pris ne servent qu'à viser juste du premier coup : c'est la contrainte
 * unique de la base qui tranche. Une insertion concurrente du même slug
 * (P2002 sur `slug`) fait réessayer avec le suivant, dans une limite de
 * `SLUG_ATTEMPTS` essais ; toute autre erreur remonte telle quelle.
 *
 * `insert` doit pouvoir être rejouée : une transaction entière, pas une
 * requête au milieu d'une transaction déjà interrompue par l'erreur.
 */
export async function insertWithUniqueSlug<T>(
  base: string,
  taken: Iterable<string>,
  insert: (slug: string) => Promise<T>,
): Promise<T> {
  const used = new Set(taken);
  let n = 1;
  const next = (): string => {
    let slug: string;
    do {
      slug = n === 1 ? base : `${base}-${n}`;
      n += 1;
    } while (used.has(slug));
    return slug;
  };
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const slug = next();
    try {
      return await insert(slug);
    } catch (error) {
      if (!isUniqueViolation(error, 'slug')) {
        throw error;
      }
      used.add(slug);
    }
  }
  throw new ConflictException(
    'Adresse indisponible pour ce nom : réessayez dans un instant.',
  );
}
