import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Durées de conservation (registre des traitements, politique de
 * confidentialité) : au-delà, les données ne servent plus et sont effacées.
 */
export const RETENTION_DAYS = {
  /** Codes de connexion, après leur expiration. */
  loginCodes: 1,
  /** Sessions fermées, après leur fermeture (les expirées partent aussitôt). */
  revokedSessions: 30,
  /** Invitations acceptées, retirées ou expirées. */
  invitations: 30,
  /** Inscriptions jamais payées (expirées, annulées). */
  unpaidRegistrations: 30,
  /** Abonnements push sans activité. */
  pushSubscriptions: 180,
} as const;

export interface PurgeReport {
  loginCodes: number;
  sessions: number;
  invitations: number;
  registrations: number;
  pushSubscriptions: number;
}

/** Purge quotidienne des données arrivées au bout de leur conservation. */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async purge(): Promise<PurgeReport> {
    const now = this.clock.now().getTime();
    const before = (days: number) => new Date(now - days * DAY_MS);

    const loginCodes = await this.prisma.loginCode.deleteMany({
      where: { expiresAt: { lt: before(RETENTION_DAYS.loginCodes) } },
    });
    const sessions = await this.prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now) } },
          { revokedAt: { lt: before(RETENTION_DAYS.revokedSessions) } },
        ],
      },
    });
    const invitationsBefore = before(RETENTION_DAYS.invitations);
    const invitations = await this.prisma.invitation.deleteMany({
      where: {
        OR: [
          { acceptedAt: { lt: invitationsBefore } },
          { revokedAt: { lt: invitationsBefore } },
          { expiresAt: { lt: invitationsBefore } },
        ],
      },
    });
    const registrationsBefore = before(RETENTION_DAYS.unpaidRegistrations);
    const registrations = await this.prisma.registration.deleteMany({
      where: {
        paidAt: null,
        teamId: null,
        OR: [
          {
            status: { in: ['EXPIRED', 'CANCELLED'] },
            createdAt: { lt: registrationsBefore },
          },
          // Place tenue jamais relâchée (paiement abandonné sans retour).
          {
            status: 'PENDING_PAYMENT',
            expiresAt: { lt: registrationsBefore },
          },
        ],
      },
    });
    const pushBefore = before(RETENTION_DAYS.pushSubscriptions);
    const pushSubscriptions = await this.prisma.pushSubscription.deleteMany({
      where: {
        updatedAt: { lt: pushBefore },
        OR: [{ lastSentAt: null }, { lastSentAt: { lt: pushBefore } }],
      },
    });

    const report: PurgeReport = {
      loginCodes: loginCodes.count,
      sessions: sessions.count,
      invitations: invitations.count,
      registrations: registrations.count,
      pushSubscriptions: pushSubscriptions.count,
    };
    this.logger.log(`Purge : ${JSON.stringify(report)}`);
    return report;
  }
}
