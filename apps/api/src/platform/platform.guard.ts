import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthKeys } from '../auth/auth-keys.js';
import { authenticate, type AuthRequest } from '../auth/auth.guard.js';
import { AUTH_KEYS } from '../auth/auth.tokens.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Espace plateforme : réservé aux admins de la plateforme (support,
 * modération). Pour tout autre compte, la route n'existe pas (404).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    @Inject(AUTH_KEYS) private readonly keys: AuthKeys | null,
    private readonly clock: Clock,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const user = await authenticate(request, this.keys, this.clock.now());
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { platformAdmin: true },
    });
    if (!account?.platformAdmin) {
      throw new NotFoundException('Page introuvable.');
    }
    return true;
  }
}
