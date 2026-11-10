import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { isDemoAccount } from '../database/demo-data.js';
import { PrismaService } from '../database/prisma.service.js';
import type { IdentityProvider } from '../generated/prisma/enums.js';
import { loginCodeMail } from '../mail/templates.js';
import { Mailer } from '../mail/mailer.js';
import {
  ACCESS_TTL_SECONDS,
  AuthKeys,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  CODES_PER_HOUR,
  SESSION_TTL_MS,
  hashRefresh,
  newLoginCode,
  newRefreshToken,
  normalizeEmail,
} from './auth-keys.js';
import { AUTH_KEYS } from './auth.tokens.js';
import type { Me, Profile, SessionResponse } from './auth.schemas.js';

/** Session ouverte : la réponse JSON et le jeton à poser en cookie. */
export interface OpenedSession {
  response: SessionResponse;
  refreshToken: string;
}

/** Identité renvoyée par Google, Apple ou Facebook, déjà vérifiée. */
export interface ExternalIdentity {
  provider: Extract<IdentityProvider, 'GOOGLE' | 'APPLE' | 'FACEBOOK'>;
  subject: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

const INVALID_CODE = 'Code incorrect ou expiré. Demandez-en un nouveau.';

/**
 * Comptes et sessions : connexion par code email (sans mot de passe) ou par
 * Google, Apple, Facebook ; un même compte réunit tous ses moyens de
 * connexion par l'adresse email.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    @Inject(AUTH_KEYS) private readonly keys: AuthKeys | null,
    config: ConfigService<Env, true>,
  ) {
    this.testCode = config.get('TEST_ACCOUNTS_CODE', { infer: true }) ?? null;
  }

  /** Code fixe des comptes de test (préprod), ou null. */
  private readonly testCode: string | null;

  async requestCode(rawEmail: string): Promise<void> {
    const keys = this.requireKeys();
    const email = normalizeEmail(rawEmail);
    const now = this.clock.now();
    const recent = await this.prisma.loginCode.count({
      where: {
        email,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
    if (recent >= CODES_PER_HOUR) {
      throw new HttpException(
        'Trop de codes demandés pour cette adresse. Réessayez dans une heure.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Compte de test en préprod : code fixe, aucun email (la boîte n'existe pas).
    const fixed = this.testCode && isDemoAccount(email) ? this.testCode : null;
    const code = fixed ?? newLoginCode();
    await this.prisma.loginCode.create({
      data: {
        email,
        codeHash: keys.hashCode(email, code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        createdAt: now,
      },
    });
    if (!fixed) {
      await this.mailer.send(loginCodeMail(email, code));
    }
  }

  async verifyCode(
    rawEmail: string,
    code: string,
    userAgent?: string,
  ): Promise<OpenedSession> {
    const keys = this.requireKeys();
    const email = normalizeEmail(rawEmail);
    const now = this.clock.now();
    const pending = await this.prisma.loginCode.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending || pending.attempts >= CODE_MAX_ATTEMPTS) {
      throw new BadRequestException(INVALID_CODE);
    }
    await this.prisma.loginCode.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
    });
    if (!keys.sameHash(pending.codeHash, keys.hashCode(email, code))) {
      throw new BadRequestException(INVALID_CODE);
    }
    // Un code ouvert ferme tous les autres codes de l'adresse.
    await this.prisma.loginCode.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: now },
    });
    const user = await this.prisma.user.upsert({
      where: { email },
      create: {
        email,
        identities: { create: { provider: 'EMAIL', subject: email } },
      },
      update: {},
    });
    await this.prisma.identity.upsert({
      where: { provider_subject: { provider: 'EMAIL', subject: email } },
      create: { userId: user.id, provider: 'EMAIL', subject: email },
      update: {},
    });
    return this.openSession(user.id, userAgent);
  }

  /**
   * Connexion par un fournisseur : l'identité connue ouvre son compte ; sinon
   * l'adresse (vérifiée par le fournisseur) rattache l'identité au compte
   * existant, ou en crée un.
   */
  async signInWith(
    identity: ExternalIdentity,
    userAgent?: string,
  ): Promise<OpenedSession> {
    const known = await this.prisma.identity.findUnique({
      where: {
        provider_subject: {
          provider: identity.provider,
          subject: identity.subject,
        },
      },
    });
    if (known) {
      return this.openSession(known.userId, userAgent);
    }
    const email = normalizeEmail(identity.email);
    const user = await this.prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: identity.firstName ?? null,
        lastName: identity.lastName ?? null,
      },
      update: {},
    });
    if (
      (!user.firstName || !user.lastName) &&
      (identity.firstName || identity.lastName)
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: user.firstName ?? identity.firstName ?? null,
          lastName: user.lastName ?? identity.lastName ?? null,
        },
      });
    }
    await this.prisma.identity.create({
      data: {
        userId: user.id,
        provider: identity.provider,
        subject: identity.subject,
      },
    });
    return this.openSession(user.id, userAgent);
  }

  /** Nouveau jeton d'accès ; le jeton de rafraîchissement est remplacé à chaque usage. */
  async refresh(
    refreshToken: string | null,
    userAgent?: string,
  ): Promise<OpenedSession> {
    const now = this.clock.now();
    const session = refreshToken
      ? await this.prisma.session.findUnique({
          where: { refreshHash: hashRefresh(refreshToken) },
        })
      : null;
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException(
        'Session expirée. Connectez-vous à nouveau.',
      );
    }
    const next = newRefreshToken();
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshHash: next.hash,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        lastUsedAt: now,
        userAgent: userAgent?.slice(0, 300) ?? session.userAgent,
      },
    });
    return {
      refreshToken: next.token,
      response: await this.sessionResponse(session.userId, session.id),
    };
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: { refreshHash: hashRefresh(refreshToken), revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
    }
  }

  async me(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        identities: { select: { provider: true } },
        memberships: {
          include: { organization: { select: { slug: true, name: true } } },
        },
        sponsorAccess: {
          include: {
            sponsor: { include: { organization: { select: { slug: true } } } },
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException('Compte introuvable.');
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      needsProfile: !user.firstName || !user.lastName,
      providers: [...new Set(user.identities.map((i) => i.provider))].sort(),
      memberships: user.memberships
        .map((m) => ({ organization: m.organization, role: m.role }))
        .sort((a, b) => a.organization.name.localeCompare(b.organization.name)),
      sponsors: user.sponsorAccess.map((a) => ({
        id: a.sponsor.id,
        name: a.sponsor.name,
        organization: a.sponsor.organization.slug,
      })),
      platformAdmin: user.platformAdmin,
    };
  }

  async updateProfile(userId: string, profile: Profile): Promise<Me> {
    await this.prisma.user.update({ where: { id: userId }, data: profile });
    return this.me(userId);
  }

  private async openSession(
    userId: string,
    userAgent?: string,
  ): Promise<OpenedSession> {
    const now = this.clock.now();
    const { token, hash } = newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshHash: hash,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        userAgent: userAgent?.slice(0, 300) ?? null,
        createdAt: now,
        lastUsedAt: now,
      },
    });
    return {
      refreshToken: token,
      response: await this.sessionResponse(userId, session.id),
    };
  }

  private async sessionResponse(
    userId: string,
    sessionId: string,
  ): Promise<SessionResponse> {
    const accessToken = await this.requireKeys().signAccess(
      { sub: userId, sid: sessionId },
      this.clock.now(),
    );
    return {
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user: await this.me(userId),
    };
  }

  private requireKeys(): AuthKeys {
    if (!this.keys) {
      throw new UnauthorizedException(
        'Connexion indisponible : AUTH_SECRET absent.',
      );
    }
    return this.keys;
  }
}
