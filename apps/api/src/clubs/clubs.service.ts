import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth.guard.js';
import type { Me } from '../auth/auth.schemas.js';
import { AuthService } from '../auth/auth.service.js';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { MemberRole } from '../generated/prisma/enums.js';
import { Mailer } from '../mail/mailer.js';
import { invitationMail } from '../mail/templates.js';
import { slugify } from '../organizer/organizer.service.js';
import { revokeLinksIssuedBy } from '../reporter/reporter-link.js';
import type {
  CreateClub,
  InviteMember,
  Members,
  PublicInvitation,
  UpdateMember,
} from './clubs.schemas.js';
import {
  CLUBS_PER_OWNER,
  INVITATIONS_PER_HOUR,
  INVITATION_TTL_MS,
  hashInvitationToken,
  maskEmail,
  newInvitationToken,
} from './invitation-token.js';

const RANK: Record<MemberRole, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };
const fullName = (u: { firstName: string | null; lastName: string | null }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || null;

/**
 * Clubs et leurs membres : création (le créateur en est propriétaire),
 * invitations par email, rôles. Un club reste toujours avec au moins un
 * propriétaire.
 */
@Injectable()
export class ClubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(user: AuthUser, input: CreateClub): Promise<Me> {
    const owned = await this.prisma.membership.count({
      where: { userId: user.id, role: 'OWNER' },
    });
    if (owned >= CLUBS_PER_OWNER) {
      throw new ConflictException(
        `Un compte peut créer ${CLUBS_PER_OWNER} clubs au plus.`,
      );
    }
    const base = slugify(input.name) || 'club';
    const taken = new Set(
      (
        await this.prisma.organization.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((o) => o.slug),
    );
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) {
      slug = `${base}-${n}`;
    }
    await this.prisma.organization.create({
      data: {
        slug,
        name: input.name,
        city: input.city ?? null,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    return this.auth.me(user.id);
  }

  async members(
    slug: string,
    user: AuthUser,
    yourRole: MemberRole,
  ): Promise<Members> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { slug },
      include: {
        members: {
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        },
        invitations: {
          where: {
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: this.clock.now() },
          },
          include: { invitedBy: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return {
      organization: {
        slug: organization.slug,
        name: organization.name,
        city: organization.city,
      },
      yourRole,
      members: organization.members
        .map((m) => ({
          userId: m.userId,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          email: m.user.email,
          role: m.role,
          joinedAt: m.createdAt.toISOString(),
          you: m.userId === user.id,
        }))
        .sort((a, b) => RANK[b.role] - RANK[a.role]),
      invitations: organization.invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        invitedBy: i.invitedBy ? fullName(i.invitedBy) : null,
      })),
    };
  }

  /** Invite par email ; une invitation en attente pour la même adresse est remplacée. */
  async invite(
    slug: string,
    user: AuthUser,
    yourRole: MemberRole,
    input: InviteMember,
  ): Promise<Members> {
    if (input.role === 'OWNER' && yourRole !== 'OWNER') {
      throw new NotFoundException('Club introuvable.');
    }
    const now = this.clock.now();
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { slug },
    });
    const already = await this.prisma.membership.findFirst({
      where: { organizationId: organization.id, user: { email: input.email } },
    });
    if (already) {
      throw new ConflictException('Cette personne est déjà membre du club.');
    }
    const recent = await this.prisma.invitation.count({
      where: {
        organizationId: organization.id,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
    if (recent >= INVITATIONS_PER_HOUR) {
      throw new HttpException(
        'Trop d’invitations envoyées. Réessayez dans une heure.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { token, hash } = newInvitationToken();
    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await this.prisma.$transaction([
      this.prisma.invitation.updateMany({
        where: {
          organizationId: organization.id,
          email: input.email,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
      this.prisma.invitation.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          role: input.role,
          tokenHash: hash,
          invitedById: user.id,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          createdAt: now,
        },
      }),
    ]);
    await this.mailer.send(
      invitationMail(input.email, {
        club: organization.name,
        invitedBy: fullName(inviter),
        role: input.role,
        url: this.appUrl(`/invite/${token}`),
      }),
    );
    return this.members(slug, user, yourRole);
  }

  async revoke(slug: string, id: string): Promise<void> {
    const { count } = await this.prisma.invitation.updateMany({
      where: {
        id,
        organization: { slug },
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: this.clock.now() },
    });
    if (count === 0) {
      throw new NotFoundException('Invitation introuvable.');
    }
  }

  /** Change le rôle d'un membre (propriétaire seulement). */
  async updateRole(
    slug: string,
    user: AuthUser,
    userId: string,
    input: UpdateMember,
  ): Promise<Members> {
    const membership = await this.findMembership(slug, userId);
    if (membership.role === 'OWNER' && input.role !== 'OWNER') {
      await this.keepAnOwner(membership.organizationId);
    }
    await this.prisma.membership.update({
      where: {
        userId_organizationId: {
          userId,
          organizationId: membership.organizationId,
        },
      },
      data: { role: input.role },
    });
    const you = await this.findMembership(slug, user.id).catch(() => null);
    if (!you) {
      throw new NotFoundException('Club introuvable.');
    }
    return this.members(slug, user, you.role);
  }

  /**
   * Retire un membre. Chacun peut quitter le club ; un admin retire un
   * bénévole ; seul un propriétaire retire un admin ou un propriétaire.
   */
  async remove(
    slug: string,
    user: AuthUser,
    yourRole: MemberRole,
    userId: string,
  ): Promise<void> {
    const membership = await this.findMembership(slug, userId);
    const self = userId === user.id;
    if (
      !self &&
      !(
        yourRole === 'OWNER' ||
        (yourRole === 'ADMIN' && membership.role === 'STAFF')
      )
    ) {
      throw new NotFoundException('Membre introuvable.');
    }
    if (membership.role === 'OWNER') {
      await this.keepAnOwner(membership.organizationId);
    }
    // Ses liens de table de marque cessent de fonctionner avec son départ.
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.delete({
        where: {
          userId_organizationId: {
            userId,
            organizationId: membership.organizationId,
          },
        },
      });
      await revokeLinksIssuedBy(
        tx,
        userId,
        membership.organizationId,
        this.clock.now(),
      );
    });
  }

  /** Invitation lue par son lien (sans connexion). */
  async invitation(token: string): Promise<PublicInvitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: { organization: true, invitedBy: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation introuvable.');
    }
    return {
      organization: {
        slug: invitation.organization.slug,
        name: invitation.organization.name,
        city: invitation.organization.city,
      },
      role: invitation.role,
      email: maskEmail(invitation.email),
      invitedBy: invitation.invitedBy ? fullName(invitation.invitedBy) : null,
      expiresAt: invitation.expiresAt.toISOString(),
      status: invitation.acceptedAt
        ? 'ACCEPTED'
        : invitation.revokedAt
          ? 'REVOKED'
          : invitation.expiresAt <= this.clock.now()
            ? 'EXPIRED'
            : 'PENDING',
    };
  }

  /** Rejoint le club, avec le compte de l'adresse invitée. */
  async accept(token: string, user: AuthUser): Promise<Me> {
    const now = this.clock.now();
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now
    ) {
      throw new NotFoundException(
        'Invitation introuvable, expirée ou déjà utilisée.',
      );
    }
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    if (account.email !== invitation.email) {
      throw new ConflictException(
        `Cette invitation est destinée à ${maskEmail(invitation.email)}. Connectez-vous avec cette adresse.`,
      );
    }
    const key = {
      userId_organizationId: {
        userId: user.id,
        organizationId: invitation.organizationId,
      },
    };
    const current = await this.prisma.membership.findUnique({ where: key });
    await this.prisma.$transaction([
      current
        ? this.prisma.membership.update({
            where: key,
            // Une invitation ne retire jamais un rôle plus élevé.
            data: {
              role:
                RANK[invitation.role] > RANK[current.role]
                  ? invitation.role
                  : current.role,
            },
          })
        : this.prisma.membership.create({
            data: {
              userId: user.id,
              organizationId: invitation.organizationId,
              role: invitation.role,
            },
          }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: now },
      }),
    ]);
    return this.auth.me(user.id);
  }

  private async findMembership(slug: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organization: { slug } },
    });
    if (!membership) {
      throw new NotFoundException('Membre introuvable.');
    }
    return membership;
  }

  private async keepAnOwner(organizationId: string): Promise<void> {
    const owners = await this.prisma.membership.count({
      where: { organizationId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw new BadRequestException(
        'Le club doit garder au moins un propriétaire. Nommez-en un autre avant.',
      );
    }
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
