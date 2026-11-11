import type { Quote } from './registrations.schemas.js';

/** Frais de service de la plateforme : 7 % + 0,50 €, payés par l'équipe (cahier des charges, section 11). */
export const SERVICE_FEE_PERCENT = 7;
export const SERVICE_FEE_FIXED_CENTS = 50;
/** Place tenue pendant le paiement (Stripe exige 30 minutes au moins). */
export const HOLD_MINUTES = 31;

export function registrationQuote(feeCents: number): Quote {
  if (feeCents <= 0) {
    return { feeCents: 0, serviceFeeCents: 0, totalCents: 0 };
  }
  const serviceFeeCents =
    Math.round((feeCents * SERVICE_FEE_PERCENT) / 100) +
    SERVICE_FEE_FIXED_CENTS;
  return { feeCents, serviceFeeCents, totalCents: feeCents + serviceFeeCents };
}

const STOP_WORDS = new Set([
  'les',
  'le',
  'la',
  'de',
  'du',
  'des',
  'd',
  'l',
  'et',
]);

/** Mots significatifs d'un nom, sans accents ni articles. */
function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/** « Les Aigles d'Annecy » → « aiglesan » (8 caractères au plus). */
export function teamCodeBase(name: string): string {
  return (words(name).join('') || 'equipe').slice(0, 8);
}

/** Monogramme de 2 à 4 lettres : initiales des mots, sinon début du nom. */
export function shortName(name: string): string {
  const all = words(name).map((w) => w.toUpperCase());
  const initials = all.map((w) => w[0]).join('');
  return (initials.length >= 2 ? initials : (all[0] ?? 'EQ')).slice(0, 4);
}
