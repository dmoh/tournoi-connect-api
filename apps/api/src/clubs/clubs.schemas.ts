import { z } from 'zod';
import { pageSchema } from '../common/pagination.js';

const role = z.enum(['OWNER', 'ADMIN', 'STAFF']);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const createClubSchema = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().min(1).max(80).optional(),
});

export const memberSchema = z.object({
  userId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string(),
  role,
  joinedAt: z.string(),
  /** La personne connectée elle-même. */
  you: z.boolean(),
});

export const pendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role,
  expiresAt: z.string(),
  invitedBy: z.string().nullable(),
});

/** Invitations en attente rendues avec les membres (les plus récentes). */
export const MAX_PENDING_INVITATIONS = 50;

/**
 * Écran des membres : une page de membres (`items`, `nextCursor`, triés par
 * rôle — propriétaires, admins, bénévoles — puis date d'arrivée et id),
 * avec le club, le rôle de la personne connectée et les invitations en
 * attente (les 50 plus récentes, identiques à chaque page).
 */
export const membersSchema = pageSchema(memberSchema).extend({
  organization: z.object({
    slug: z.string(),
    name: z.string(),
    city: z.string().nullable(),
  }),
  /** Rôle de la personne connectée dans ce club. */
  yourRole: role,
  invitations: z.array(pendingInvitationSchema),
});

export const inviteMemberSchema = z.object({ email, role });

export const updateMemberSchema = z.object({ role });

export const publicInvitationSchema = z.object({
  organization: z.object({
    slug: z.string(),
    name: z.string(),
    city: z.string().nullable(),
  }),
  role,
  /** Adresse invitée, masquée (c•••@exemple.fr). */
  email: z.string(),
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
  status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']),
});

export type CreateClub = z.infer<typeof createClubSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Members = z.infer<typeof membersSchema>;
export type InviteMember = z.infer<typeof inviteMemberSchema>;
export type UpdateMember = z.infer<typeof updateMemberSchema>;
export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;
export type PublicInvitation = z.infer<typeof publicInvitationSchema>;
