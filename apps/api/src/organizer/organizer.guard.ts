import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  BadRequestException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthKeys } from '../auth/auth-keys.js';
import { authenticate, type AuthRequest } from '../auth/auth.guard.js';
import { AUTH_KEYS } from '../auth/auth.tokens.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { MemberRole } from '../generated/prisma/enums.js';

/** Club ouvert par la requête, posé par OrganizerGuard. */
export interface OrganizerRequest extends AuthRequest {
  organizationSlug?: string;
  memberRole?: MemberRole;
}

const RANK: Record<MemberRole, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };
const MIN_ROLE = 'organizer:minRole';

/** Rôle minimal d'une route organisateur (ADMIN par défaut ; STAFF pour la saisie). */
export const OrganizerRole = (role: MemberRole) => SetMetadata(MIN_ROLE, role);

/**
 * Espace organisateur : une personne connectée, membre du club choisi par
 * l'en-tête X-Organization (ou de son seul club), avec le rôle suffisant.
 * Un club dont on n'est pas membre répond 404, jamais 403.
 */
@Injectable()
export class OrganizerGuard implements CanActivate {
  constructor(
    @Inject(AUTH_KEYS) private readonly keys: AuthKeys | null,
    private readonly clock: Clock,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrganizerRequest>();
    const user = await authenticate(request, this.keys, this.clock.now());
    const minRole =
      this.reflector.getAllAndOverride<MemberRole | undefined>(MIN_ROLE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'ADMIN';
    const wanted = request.headers['x-organization'];
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: user.id,
        ...(typeof wanted === 'string'
          ? { organization: { slug: wanted } }
          : {}),
      },
      include: { organization: { select: { slug: true } } },
    });
    if (typeof wanted !== 'string' && memberships.length > 1) {
      throw new BadRequestException(
        'Précisez le club (en-tête X-Organization).',
      );
    }
    const membership = memberships.length === 1 ? memberships[0] : undefined;
    if (!membership || RANK[membership.role] < RANK[minRole]) {
      throw new NotFoundException('Club introuvable.');
    }
    request.organizationSlug = membership.organization.slug;
    request.memberRole = membership.role;
    return true;
  }
}
