import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  REFERRAL_ALPHABET,
  referralCodeSchema,
  type PublicReferral,
  type Referral,
} from './referrals.schemas.js';

const newCode = () =>
  Array.from(
    { length: 8 },
    () => REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)],
  ).join('');

/**
 * Parrainage entre clubs : chaque club a un lien de création de club qui
 * porte son code ; un club créé par ce lien garde son parrain. Suivi
 * seulement : l'avantage commercial viendra plus tard.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Code du club (créé au premier appel) et clubs qu'il a parrainés. */
  async forClub(slug: string): Promise<Referral> {
    const club = await this.prisma.organization.findUniqueOrThrow({
      where: { slug },
      include: {
        referrals: {
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: {
                tournaments: { where: { status: { not: 'DRAFT' } } },
              },
            },
          },
        },
      },
    });
    const code = club.referralCode ?? (await this.assignCode(club.id));
    return {
      code,
      url: `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}/clubs/new?parrain=${code}`,
      clubs: club.referrals.map((r) => ({
        name: r.name,
        city: r.city,
        joinedAt: r.createdAt.toISOString(),
        active: r._count.tournaments > 0,
      })),
    };
  }

  /** Club parrain d'un code, pour l'afficher sur l'écran de création. */
  async lookup(rawCode: string): Promise<PublicReferral> {
    const parsed = referralCodeSchema.safeParse(rawCode);
    const club = parsed.success
      ? await this.prisma.organization.findUnique({
          where: { referralCode: parsed.data },
          select: { name: true, city: true },
        })
      : null;
    if (!club) {
      throw new NotFoundException('Lien de parrainage inconnu.');
    }
    return { club };
  }

  /** Identifiant du club parrain, ou null pour un code absent ou inconnu. */
  async referrerId(rawCode: string | undefined): Promise<string | null> {
    const parsed = referralCodeSchema.safeParse(rawCode ?? '');
    if (!parsed.success) {
      return null;
    }
    const club = await this.prisma.organization.findUnique({
      where: { referralCode: parsed.data },
      select: { id: true },
    });
    return club?.id ?? null;
  }

  private async assignCode(clubId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      try {
        // Seulement si le club n'a pas déjà reçu un code entre-temps.
        const { count } = await this.prisma.organization.updateMany({
          where: { id: clubId, referralCode: null },
          data: { referralCode: code },
        });
        if (count === 1) {
          return code;
        }
        const club = await this.prisma.organization.findUniqueOrThrow({
          where: { id: clubId },
          select: { referralCode: true },
        });
        return club.referralCode!;
      } catch (error) {
        // Code déjà pris par un autre club : on en tire un autre.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
      }
    }
    throw new Error('Impossible d’attribuer un code de parrainage.');
  }
}
