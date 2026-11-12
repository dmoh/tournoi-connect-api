import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Pagination par curseur des listes (cahier des charges) : tri stable sur une
 * clé composée (date ou texte, puis identifiant), 50 éléments au plus par
 * page, curseur opaque.
 *
 * Contrat commun à toutes les listes paginées :
 * - requête `?cursor=<curseur>&limit=<1 à 50, 20 par défaut>` ;
 * - réponse `{ items: T[], nextCursor: string | null }`, `nextCursor` nul
 *   sur la dernière page ;
 * - limite hors bornes ou curseur illisible, falsifié ou d'une autre liste
 *   (ou d'un autre tri) : 400 en problem+json.
 *
 * Les dates sont comparées à la milliseconde : Prisma les écrit depuis
 * JavaScript (`now()` est évalué par le client), jamais à la microseconde.
 */

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

/** Curseur opaque (base64url) rendu par la page précédente. */
export const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\w-]+$/, 'Curseur invalide.');

/** Paramètres communs `cursor` et `limit`, à étendre par les filtres d'une liste. */
export const pageQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  /** Curseur de la page suivante ; null sur la dernière page. */
  nextCursor: string | null;
}

/** Schéma de réponse `{ items, nextCursor }` d'une liste paginée. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    /** À renvoyer tel quel en `?cursor=` ; null sur la dernière page. */
    nextCursor: z.string().nullable(),
  });
}

const INVALID_CURSOR = 'Curseur invalide.';

/** Valeur d'une clé de tri : date (ISO), texte ou nombre. */
export type CursorValue = string | number;

/**
 * Curseur opaque : la portée (liste et tri) suivie des valeurs de la clé
 * composée du dernier élément rendu, en JSON encodé base64url.
 */
export function encodeCursor(
  scope: string,
  values: readonly CursorValue[],
): string {
  return Buffer.from(JSON.stringify([scope, ...values]), 'utf8').toString(
    'base64url',
  );
}

/**
 * Valeurs d'un curseur de cette portée, validées par `schema` (un tuple zod).
 * Tout curseur illisible, d'une autre portée ou mal formé répond 400.
 */
export function decodeCursor<T extends z.ZodTuple>(
  cursor: string,
  scope: string,
  schema: T,
): z.output<T> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException(INVALID_CURSOR);
  }
  if (!Array.isArray(decoded) || decoded[0] !== scope) {
    throw new BadRequestException(INVALID_CURSOR);
  }
  const parsed = schema.safeParse(decoded.slice(1));
  if (!parsed.success) {
    throw new BadRequestException(INVALID_CURSOR);
  }
  return parsed.data;
}

export type Direction = 'asc' | 'desc';

/** Clé du dernier élément rendu : valeur triée puis identifiant. */
export interface SeekKey<V extends Date | string> {
  value: V;
  id: string;
}

type Compare<V> = { lt: V } | { gt: V };

/** Filtre Prisma « après le curseur » sur (clé, identifiant). */
export type SeekWhere<K extends string, I extends string, V> =
  | {
      OR: (
        Record<K, Compare<V>> | (Record<K, V> & Record<I, Compare<string>>)
      )[];
    }
  | { OR?: never };

/**
 * Éléments situés après `after` dans l'ordre (clé, identifiant) : clé
 * strictement après, ou clé égale et identifiant après. Sans curseur, aucun
 * filtre (première page).
 */
export function seekAfter<
  K extends string,
  I extends string,
  V extends Date | string,
>(
  key: K,
  idKey: I,
  direction: Direction,
  after: SeekKey<V> | null,
): SeekWhere<K, I, V> {
  if (!after) {
    return {};
  }
  const op = direction === 'asc' ? 'gt' : 'lt';
  return {
    OR: [
      { [key]: { [op]: after.value } } as Record<K, Compare<V>>,
      {
        [key]: after.value,
        [idKey]: { [op]: after.id },
      } as Record<K, V> & Record<I, Compare<string>>,
    ],
  };
}

/** Tri stable de Prisma sur (clé, identifiant), dans le même sens. */
export function seekOrder<K extends string, I extends string>(
  key: K,
  idKey: I,
  direction: Direction,
): [Record<K, Direction>, Record<I, Direction>] {
  return [
    { [key]: direction } as Record<K, Direction>,
    { [idKey]: direction } as Record<I, Direction>,
  ];
}

/**
 * Page rendue depuis `limit + 1` lignes lues : la ligne en trop dit qu'il
 * reste une page, et le curseur pointe la dernière ligne gardée.
 */
export function takePage<R>(
  rows: readonly R[],
  limit: number,
  cursorOf: (row: R) => string,
): { rows: R[]; nextCursor: string | null } {
  const kept = rows.slice(0, limit);
  const last = kept.at(-1);
  return {
    rows: kept,
    nextCursor: rows.length > limit && last ? cursorOf(last) : null,
  };
}

const idSchema = z.string().min(1).max(64);
const dateKeySchema = z.tuple([
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  idSchema,
]);
const textKeySchema = z.tuple([z.string().max(500), idSchema]);

/** Sorte de clé triée : date (`Date` en Prisma) ou texte. */
export type KeyKind = 'date' | 'text';
type KeyValue<D extends KeyKind> = D extends 'date' ? Date : string;

/** Liste paginée sur (date ou texte, identifiant). */
export interface KeysetOptions<
  K extends string,
  D extends KeyKind,
  I extends string,
> {
  /** Portée du curseur : nom de la liste et tri (« registrations:createdAt:desc »). */
  scope: string;
  key: K;
  kind: D;
  direction: Direction;
  /** Identifiant départageant deux clés égales (« id » par défaut). */
  idKey?: I;
}

/**
 * Requête Prisma d'une page et mise en forme du résultat :
 *
 * ```ts
 * const page = keyset({ scope: 'news', key: 'publishedAt', kind: 'date', direction: 'desc' }, query);
 * const rows = await prisma.post.findMany({
 *   where: { tournamentId, ...page.where }, orderBy: page.orderBy, take: page.take,
 * });
 * return page.finish(rows, toView);
 * ```
 */
export function keyset<
  K extends string,
  D extends KeyKind,
  I extends string = 'id',
>(options: KeysetOptions<K, D, I>, query: PageQuery) {
  const idKey = (options.idKey ?? 'id') as I;
  const decoded = query.cursor
    ? options.kind === 'date'
      ? decodeCursor(query.cursor, options.scope, dateKeySchema)
      : decodeCursor(query.cursor, options.scope, textKeySchema)
    : null;
  const after: SeekKey<KeyValue<D>> | null = decoded
    ? { value: decoded[0] as KeyValue<D>, id: decoded[1] }
    : null;
  type Row = Record<K, KeyValue<D>> & Record<I, string>;
  /** Curseur pointant cette ligne (dernière ligne gardée de la page). */
  const cursorOf = (row: Row): string => {
    const value: unknown = row[options.key];
    return encodeCursor(options.scope, [
      value instanceof Date ? value.toISOString() : String(value),
      row[idKey],
    ]);
  };
  return {
    where: seekAfter(options.key, idKey, options.direction, after),
    orderBy: seekOrder(options.key, idKey, options.direction),
    /** Une ligne de plus que la page : il reste une page si elle existe. */
    take: query.limit + 1,
    cursorOf,
    finish<R extends Row, T>(rows: readonly R[], map: (row: R) => T): Page<T> {
      const page = takePage(rows, query.limit, cursorOf);
      return { items: page.rows.map(map), nextCursor: page.nextCursor };
    },
  };
}
