import { createHash, randomBytes } from 'node:crypto';

/** Validité d'une invitation. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Invitations qu'un club peut envoyer par heure (protège la réputation d'envoi). */
export const INVITATIONS_PER_HOUR = 30;
/** Clubs qu'un compte peut créer (un club est rarement plus). */
export const CLUBS_PER_OWNER = 5;

/** Jeton du lien d'invitation : 256 bits, seule son empreinte est gardée. */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** « camille.perrin@example.org » → « c•••@example.org ». */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}
