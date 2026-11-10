import { z } from 'zod';

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

export const membersSchema = z.object({
  organization: z.object({
    slug: z.string(),
    name: z.string(),
    city: z.string().nullable(),
  }),
  /** Rôle de la personne connectée dans ce club. */
  yourRole: role,
  members: z.array(memberSchema),
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
