import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthProviders } from '../auth/oauth/oauth-providers.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PlatformOverview } from './platform.schemas.js';

/** Indicateurs de la plateforme et état des services configurés. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(OAuthProviders) private readonly oauth: OAuthProviders,
  ) {}

  async overview(): Promise<PlatformOverview> {
    const [
      accounts,
      clubs,
      published,
      inProgress,
      drafts,
      confirmed,
      openReports,
      referredClubs,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.organization.count(),
      this.prisma.tournament.count({
        where: { status: { in: ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] } },
      }),
      this.prisma.tournament.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.tournament.count({ where: { status: 'DRAFT' } }),
      this.prisma.registration.aggregate({
        where: { status: 'CONFIRMED' },
        _count: { _all: true },
        _sum: { totalCents: true, serviceFeeCents: true },
      }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.organization.count({
        where: { referredById: { not: null } },
      }),
    ]);
    const has = (key: keyof Env) =>
      Boolean(this.config.get(key, { infer: true }));
    const secretKey = this.config.get('STRIPE_SECRET_KEY', { infer: true });
    return {
      counts: {
        accounts,
        clubs,
        tournaments: { published, inProgress, drafts },
        confirmedRegistrations: confirmed._count._all,
        paidCents: confirmed._sum.totalCents ?? 0,
        serviceFeeCents: confirmed._sum.serviceFeeCents ?? 0,
        openReports,
        referredClubs,
      },
      services: {
        mail: this.config.get('MAIL_TRANSPORT', { infer: true }) === 'ses',
        payments: {
          secretKey: Boolean(secretKey),
          webhook: has('STRIPE_WEBHOOK_SECRET'),
          connectWebhook: has('STRIPE_CONNECT_WEBHOOK_SECRET'),
          testMode: Boolean(secretKey?.startsWith('sk_test_')),
        },
        push: has('VAPID_PUBLIC_KEY') && has('VAPID_PRIVATE_KEY'),
        oauth: this.oauth.enabled(),
        queues: has('REDIS_URL'),
        testAccounts: has('TEST_ACCOUNTS_CODE'),
      },
    };
  }
}
