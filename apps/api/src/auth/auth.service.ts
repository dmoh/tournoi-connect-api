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
  FAILED_ATTEMPTS_PER_DAY,
  FAILED_ATTEMPTS_WINDOW_MS,
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
const TOO_MANY_CODES =
  'Trop de tentatives pour cette adresse. Réessayez plus tard.';
const SESSION_EXPIRED = 'Session expirée. Connectez-vous à nouveau.';

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
    // validateEnv ignore déjà le code sans le drapeau ; revérifié ici.
    this.testCode =
      config.get('ALLOW_TEST_ACCOUNTS', { infer: true }) === 'true'
        ? (config.get('TEST_ACCOUNTS_CODE', { infer: true }) ?? null)
        : null;
  }

  /** Code fixe des comptes de test (préprod, ALLOW_TEST_ACCOUNTS=true), ou null. */
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
    if (recent >= CODES_PER_HOUR || (await this.isLocked(email, now))) {
      throw new HttpException(TOO_MANY_CODES, HttpStatus.TOO_MANY_REQUESTS);
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

  /**
   * Chaque essai réserve d'abord sa place (incrément conditionnel atomique)
   * avant la comparaison : des requêtes parallèles ne dépassent jamais les
   * 5 essais d'un code. Un essai réussi rend sa place : `attempts` compte les
   * essais ratés, que cumule le plafond sur 24 heures.
   */
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
    if (!pending || (await this.isLocked(email, now))) {
      throw new BadRequestException(INVALID_CODE);
    }
    const counted = await this.prisma.loginCode.updateMany({
      where: {
        id: pending.id,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: CODE_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (
      counted.count === 0 ||
      !keys.sameHash(pending.codeHash, keys.hashCode(email, code))
    ) {
      throw new BadRequestException(INVALID_CODE);
    }
    const userId = await this.prisma.$transaction(async (tx) => {
      // Un seul gagnant pour un même code : les autres requêtes voient
      // consumedAt déjà posé et repartent sans session.
      const consumed = await tx.loginCode.updateMany({
        where: { id: pending.id, consumedAt: null },
        data: { consumedAt: now, attempts: { decrement: 1 } },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(INVALID_CODE);
      }
      // Un code ouvert ferme tous les autres codes de l'adresse.
      await tx.loginCode.updateMany({
        where: { email, consumedAt: null },
        data: { consumedAt: now },
      });
      const user = await tx.user.upsert({
        where: { email },
        create: {
          email,
          identities: { create: { provider: 'EMAIL', subject: email } },
        },
        update: {},
      });
      await tx.identity.upsert({
        where: { provider_subject: { provider: 'EMAIL', subject: email } },
        create: { userId: user.id, provider: 'EMAIL', subject: email },
        update: {},
      });
      return user.id;
    });
    return this.openSession(userId, userAgent);
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

  /**
   * Nouveau jeton d'accès ; le jeton de rafraîchissement est remplacé à chaque
   * usage, par une écriture conditionnée à l'ancien : de deux requêtes
   * parallèles avec le même jeton, une seule obtient le suivant.
   */
  async refresh(
    refreshToken: string | null,
    userAgent?: string,
  ): Promise<OpenedSession> {
    const now = this.clock.now();
    const refreshHash = refreshToken ? hashRefresh(refreshToken) : null;
    const session = refreshHash
      ? await this.prisma.session.findUnique({ where: { refreshHash } })
      : null;
    if (!refreshHash || !session) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    const next = newRefreshToken();
    const rotated = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        refreshHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshHash: next.hash,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        lastUsedAt: now,
        userAgent: userAgent?.slice(0, 300) ?? session.userAgent,
      },
    });
    if (rotated.count !== 1) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
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

  /**
   * Plafond d'essais ratés de l'adresse sur 24 heures, tous codes confondus.
   * Lecture non verrouillée : des requêtes parallèles peuvent le dépasser
   * d'au plus 4 essais (ceux du dernier code, bornés à 5 de façon atomique).
   */
  private async isLocked(email: string, now: Date): Promise<boolean> {
    const failed = await this.prisma.loginCode.aggregate({
      where: {
        email,
        createdAt: { gt: new Date(now.getTime() - FAILED_ATTEMPTS_WINDOW_MS) },
      },
      _sum: { attempts: true },
    });
    return (failed._sum.attempts ?? 0) >= FAILED_ATTEMPTS_PER_DAY;
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
