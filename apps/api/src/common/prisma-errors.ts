import { Prisma } from '../generated/prisma/client.js';

/** Erreur Prisma connue (P2002, P2025…) : la classe du client généré. */
export function isPrismaError(
  error: unknown,
  code?: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (code === undefined || error.code === code)
  );
}

/**
 * Violation d'unicité (P2002), sur le champ donné s'il est précisé.
 *
 * Avec le pilote pg (Prisma 7), le champ n'est pas dans `meta.target` mais
 * dans l'erreur du pilote : nom de l'index (« tournament_slug_key ») ou liste
 * des colonnes. Sans aucune de ces informations, la violation est retenue.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!isPrismaError(error, 'P2002')) {
    return false;
  }
  if (field === undefined) {
    return true;
  }
  const meta = (error.meta ?? {}) as {
    target?: unknown;
    driverAdapterError?: {
      cause?: { constraint?: { index?: unknown; fields?: unknown } };
    };
  };
  const constraint = meta.driverAdapterError?.cause?.constraint;
  const names = [
    ...(Array.isArray(meta.target) ? meta.target : [meta.target]),
    ...(Array.isArray(constraint?.fields) ? constraint.fields : []),
    constraint?.index,
  ].filter((name): name is string => typeof name === 'string');
  return (
    names.length === 0 ||
    names.some((name) => name === field || name.endsWith(`_${field}_key`))
  );
}
