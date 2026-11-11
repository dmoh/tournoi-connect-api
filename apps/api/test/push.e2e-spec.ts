import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PushSender, type PushTarget } from '../src/push/push-sender.js';
import { createTestApp, login } from './setup-app.js';

/** Faux service push : garde les notifications reçues par adresse. */
class FakePushSender {
  publicKey = 'BPublicKeyForTests';
  inbox = new Map<string, { title: string; body: string; url: string }[]>();
  gone = new Set<string>();
  send = vi.fn(
    (
      target: PushTarget,
      payload: { notification: Record<string, unknown> },
    ) => {
      if (this.gone.has(target.endpoint)) {
        return Promise.resolve('gone' as const);
      }
      const n = payload.notification as {
        title: string;
        body: string;
        data: { onActionClick: { default: { url: string } } };
      };
      const list = this.inbox.get(target.endpoint) ?? [];
      list.push({
        title: n.title,
        body: n.body,
        url: n.data.onActionClick.default.url,
      });
      this.inbox.set(target.endpoint, list);
      return Promise.resolve('sent' as const);
    },
  );
}

describe('Suivis et notifications (e2e)', () => {
  const sender = new FakePushSender();
  let app: NestFastifyApplication;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp([
      { provide: PushSender, useValue: sender },
    ]);
    app = ctx.app;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    sender.inbox.clear();
    sender.gone.clear();
  });
  afterAll(() => app.close());

  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  const all = { kickoff: true, goals: true, results: true };
  const subscribe = (
    endpoint: string,
    follows: { tournaments: string[]; teams: string[] },
    preferences = all,
    token?: string,
  ) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/push/subscriptions',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: { endpoint, keys, follows, preferences },
    });
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  it('fusionne les suivis de l’appareil dans le compte, puis les remplace', async () => {
    const token = await login(app, 'lea@example.com');
    const merged = await app.inject({
      method: 'POST',
      url: '/api/v1/me/follows/merge',
      headers: as(token),
      payload: {
        tournaments: ['challenge-u13-arve'],
        teams: ['challenge-u13-arve/rdg'],
      },
    });
    expect(merged.json()).toEqual({
      tournaments: ['challenge-u13-arve'],
      teams: ['challenge-u13-arve/rdg'],
    });
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/me/follows/merge',
      headers: as(token),
      payload: {
        tournaments: ['basket-3x3-annecy', 'challenge-u13-arve'],
        teams: [],
      },
    });
    expect(again.json().tournaments).toEqual([
      'challenge-u13-arve',
      'basket-3x3-annecy',
    ]);
    const replaced = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/follows',
      headers: as(token),
      payload: { tournaments: [], teams: ['challenge-u13-arve/adb'] },
    });
    expect(replaced.json()).toEqual({
      tournaments: [],
      teams: ['challenge-u13-arve/adb'],
    });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/me/follows',
          payload: { tournaments: [], teams: [] },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('notifie coup d’envoi, buts et résultat à ceux qui suivent, selon leurs préférences', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/push/config' })).json(),
    ).toEqual({ publicKey: 'BPublicKeyForTests' });

    // Appareil anonyme qui suit le tournoi ; compte qui suit une équipe ; appareil sans les buts.
    await subscribe('https://push.test/tournoi', {
      tournaments: ['challenge-u13-arve'],
      teams: [],
    });
    const lea = await login(app, 'lea@example.com');
    await app.inject({
      method: 'PUT',
      url: '/api/v1/me/follows',
      headers: as(lea),
      payload: { tournaments: [], teams: ['challenge-u13-arve/rdg'] },
    });
    await subscribe(
      'https://push.test/compte',
      { tournaments: [], teams: [] },
      all,
      lea,
    );
    await subscribe(
      'https://push.test/sans-buts',
      { tournaments: [], teams: ['challenge-u13-arve/adb'] },
      { kickoff: true, goals: false, results: true },
    );
    await subscribe('https://push.test/autre', {
      tournaments: ['basket-3x3-annecy'],
      teams: [],
    });

    const owner = await login(app, 'orga@example.org');
    const { token } = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/organizer/tournaments/challenge-u13-arve/matches/a6/reporter-link',
        headers: as(owner),
      })
    ).json<{ token: string }>();
    const record = (event: object) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/reporter/${token}/events`,
        payload: event,
      });

    await record({
      clientEventId: 'evt-save-0001',
      type: 'SAVE',
      side: 'home',
      minute: 1,
    });
    await record({
      clientEventId: 'evt-goal-0002',
      type: 'GOAL',
      side: 'home',
      minute: 7,
      player: 'T. Roux',
    });
    // Renvoi de la file hors ligne : pas de seconde notification.
    await record({
      clientEventId: 'evt-goal-0002',
      type: 'GOAL',
      side: 'home',
      minute: 7,
      player: 'T. Roux',
    });
    await record({
      clientEventId: 'evt-end-000003',
      type: 'FULL_TIME',
      minute: 24,
    });

    const titles = (endpoint: string) =>
      (sender.inbox.get(endpoint) ?? []).map((n) => n.title);
    expect(titles('https://push.test/tournoi')).toEqual([
      'Coup d’envoi',
      'But pour Racing du Giffre !',
      'Fin du match',
    ]);
    expect(titles('https://push.test/compte')).toEqual(
      titles('https://push.test/tournoi'),
    );
    expect(titles('https://push.test/sans-buts')).toEqual([
      'Coup d’envoi',
      'Fin du match',
    ]);
    expect(sender.inbox.get('https://push.test/autre')).toBeUndefined();
    expect(sender.inbox.get('https://push.test/tournoi')?.[1]).toEqual({
      title: 'But pour Racing du Giffre !',
      body: 'Racing du Giffre 1 – 0 Avenir des Bornes (7’) · T. Roux',
      url: '/t/challenge-u13-arve/m/a6',
    });
  });

  it('oublie un abonnement expiré chez le navigateur et désabonne sur demande', async () => {
    await subscribe('https://push.test/expire', {
      tournaments: ['challenge-u13-arve'],
      teams: [],
    });
    await subscribe('https://push.test/garde', {
      tournaments: ['challenge-u13-arve'],
      teams: [],
    });
    sender.gone.add('https://push.test/expire');
    const owner = await login(app, 'orga@example.org');
    const { token } = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/organizer/tournaments/challenge-u13-arve/matches/a6/reporter-link',
        headers: as(owner),
      })
    ).json<{ token: string }>();
    const record = (id: string, type: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/reporter/${token}/events`,
        payload: { clientEventId: id, type, side: 'away', minute: 2 },
      });
    await record('evt-goal-1001', 'GOAL');
    sender.gone.clear();
    await app.inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions/delete',
      payload: { endpoint: 'https://push.test/garde' },
    });
    await record('evt-goal-1002', 'GOAL');
    // L'expiré a été supprimé au premier envoi ; le second appareil s'est désabonné.
    expect(sender.inbox.get('https://push.test/expire')).toBeUndefined();
    expect(sender.inbox.get('https://push.test/garde')).toHaveLength(1);
  });
});
