import type { Clock } from '../common/clock.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { PushSender, PushTarget } from './push-sender.js';
import type { MatchNotification } from './push.schemas.js';
import {
  notificationJobId,
  PUSH_CONCURRENCY,
  PushService,
} from './push.service.js';

const goal: MatchNotification = {
  kind: 'goal',
  tournamentSlug: 'challenge-u13-arve',
  matchCode: 'a6',
  homeTeam: 'rdg',
  awayTeam: 'adb',
  title: 'But pour Racing du Giffre !',
  body: 'Racing du Giffre 1 – 0 Avenir des Bornes (7’)',
};

describe('PushService', () => {
  describe('identifiant de tâche', () => {
    it('est stable pour la même notification et accepté par BullMQ', () => {
      const id = notificationJobId(goal);
      expect(notificationJobId({ ...goal })).toBe(id);
      expect(id).not.toContain(':');
      expect(id).toMatch(/^match-[\w-]{32}$/);
    });

    it('distingue les événements et les matchs', () => {
      const id = notificationJobId(goal);
      expect(notificationJobId({ ...goal, body: 'Racing 2 – 0' })).not.toBe(id);
      expect(notificationJobId({ ...goal, matchCode: 'a7' })).not.toBe(id);
      expect(notificationJobId({ ...goal, eventId: 'evt-1' })).not.toBe(
        notificationJobId({ ...goal, eventId: 'evt-2' }),
      );
      // L'événement source suffit : un titre retouché ne fait pas un doublon.
      expect(notificationJobId({ ...goal, eventId: 'evt-1' })).toBe(
        notificationJobId({ ...goal, eventId: 'evt-1', title: 'But !' }),
      );
    });

    it('dépose la notification dans la file avec cet identifiant', async () => {
      const queue = { add: vi.fn() };
      const service = new PushService(
        {} as PrismaService,
        { publicKey: 'BKey' } as PushSender,
        {} as Clock,
        queue as never,
      );
      await service.notify(goal);
      expect(queue.add).toHaveBeenCalledWith('match', goal, {
        jobId: notificationJobId(goal),
      });
    });
  });

  it('envoie en parallèle borné puis enregistre le suivi en deux requêtes', async () => {
    const targets: (PushTarget & { id: string })[] = [
      ...Array.from({ length: 95 }, (_, i) => ({
        id: `s${i}`,
        endpoint: `https://fcm.googleapis.com/fcm/send/${i}`,
        p256dh: 'p',
        auth: 'a',
      })),
      // Ancien abonnement vers un hôte inconnu : jamais contacté, supprimé.
      { id: 'legacy', endpoint: 'https://push.test/x', p256dh: 'p', auth: 'a' },
    ];
    const now = new Date('2026-11-11T10:00:00Z');
    const prisma = {
      follow: { findMany: vi.fn().mockResolvedValue([]) },
      pushSubscription: {
        findMany: vi.fn().mockResolvedValue(targets),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn(),
      },
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn(async (target: PushTarget) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      const n = Number(target.endpoint.split('/').at(-1));
      return n % 10 === 0 ? 'gone' : n % 10 === 1 ? 'failed' : 'sent';
    });
    const service = new PushService(
      prisma as unknown as PrismaService,
      { publicKey: 'BKey', send } as unknown as PushSender,
      { now: () => now },
    );

    const result = await service.deliver(goal);

    expect(send).toHaveBeenCalledTimes(95);
    expect(send.mock.calls.map(([t]) => t.endpoint)).not.toContain(
      'https://push.test/x',
    );
    expect(maxInFlight).toBe(PUSH_CONCURRENCY);
    expect(result).toEqual({ sent: 75, gone: 11 });
    expect(prisma.pushSubscription.update).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledTimes(1);
    const updated = prisma.pushSubscription.updateMany.mock.calls[0]![0];
    expect(updated.data).toEqual({ lastSentAt: now });
    expect(updated.where.id.in).toHaveLength(75);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledTimes(1);
    const deleted: string[] =
      prisma.pushSubscription.deleteMany.mock.calls[0]![0].where.id.in;
    const expected = [
      'legacy',
      ...Array.from({ length: 10 }, (_, i) => `s${i * 10}`),
    ];
    expect(deleted).toHaveLength(expected.length);
    expect(deleted).toEqual(expect.arrayContaining(expected));
  });
});
