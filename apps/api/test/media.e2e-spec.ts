import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import {
  MEDIA_STORAGE,
  MediaStorage,
  type SignedUpload,
  type StoredObject,
} from '../src/media/media-storage.js';
import { MediaService } from '../src/media/media.service.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

const SLUG = 'challenge-u13-arve';
const ORG = 'etoile-de-l-arve';
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];

/** Faux bucket : l'appareil « envoie » en écrivant dans objects. */
class FakeStorage extends MediaStorage {
  enabled = true;
  objects = new Map<string, StoredObject>();
  removed: string[] = [];
  keys: string[] = [];

  signUpload(key: string, contentType: string, bytes: number, now: Date) {
    this.keys.push(key);
    return Promise.resolve<SignedUpload>({
      url: `https://bucket.test/${key}?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&n=${bytes}`,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(now.getTime() + 600_000),
    });
  }
  inspect(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(keys: readonly string[]) {
    this.removed.push(...keys);
    for (const key of keys) {
      this.objects.delete(key);
    }
    return Promise.resolve();
  }
  publicUrl(key: string) {
    return `https://media.test/${key}`;
  }
  /** Simule l'envoi du fichier par l'appareil. */
  put(key: string, bytes: number, head = JPEG, contentType = 'image/jpeg') {
    this.objects.set(key, {
      bytes,
      contentType,
      head: Uint8Array.from(head),
    });
  }
}

const photo = (extra: object = {}) => ({
  contentType: 'image/jpeg',
  bytes: 180_000,
  width: 1600,
  height: 1200,
  consent: true,
  ...extra,
});

describe('Photos et temps forts (e2e)', () => {
  const storage = new FakeStorage();
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let owner: string;

  beforeAll(async () => {
    const ctx = await createTestApp([
      { provide: MEDIA_STORAGE, useValue: storage },
    ]);
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    await prisma.report.deleteMany();
    storage.enabled = true;
    storage.objects.clear();
    storage.removed = [];
    storage.keys = [];
    owner = await login(app);
  });
  afterAll(() => app.close());

  const as = (token: string) => ({
    authorization: `Bearer ${token}`,
    'x-organization': ORG,
  });
  const reporterToken = async (match = 'b5') =>
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/organizer/tournaments/${SLUG}/matches/${match}/reporter-link`,
        headers: as(owner),
      })
    ).json<{ token: string }>().token;
  const post = (url: string, payload?: object, headers = {}) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, payload, headers });
  const get = (url: string, headers = {}) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
  const publicPhotos = async (query = '') =>
    (await get(`/public/tournaments/${SLUG}/photos${query}`)).json<
      { id: string; url: string; highlight: boolean; matchCode: string }[]
    >();
  const feed = async (match = 'b5') =>
    (await get(`/public/tournaments/${SLUG}/matches/${match}/feed`)).json<{
      events: { type: string; caption?: string; photo?: { url: string } }[];
    }>();

  /** Photo de la table de marque, envoyée et confirmée. */
  const reporterPhoto = async (token: string, caption = 'Belle action') => {
    const upload = await post(`/reporter/${token}/photos`, photo({ caption }));
    expect(upload.statusCode).toBe(200);
    const { photoId } = upload.json<{ photoId: string }>();
    storage.put(storage.keys.at(-1)!, 180_000);
    const confirmed = await post(
      `/reporter/${token}/photos/${photoId}/confirm`,
    );
    expect(confirmed.statusCode).toBe(200);
    return photoId;
  };

  it('la table de marque envoie une photo par URL signée et la joint au direct', async () => {
    const token = await reporterToken();
    const upload = await post(`/reporter/${token}/photos`, photo());
    expect(upload.statusCode).toBe(200);
    const body = upload.json<{
      photoId: string;
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: string;
    }>();
    expect(body.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(body.expiresAt).toBe(
      new Date(DEMO_NOW.getTime() + 600_000).toISOString(),
    );
    const key = storage.keys.at(-1)!;
    expect(key).toMatch(/^photos\/[^/]+\/[0-9a-f-]{36}\.jpg$/);

    // Pas encore envoyée : rien à publier.
    const early = await post(
      `/reporter/${token}/photos/${body.photoId}/confirm`,
    );
    expect(early.statusCode).toBe(409);
    expect(await publicPhotos()).toEqual([]);

    storage.put(key, 180_000);
    const confirmed = await post(
      `/reporter/${token}/photos/${body.photoId}/confirm`,
    );
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      id: body.photoId,
      url: `https://media.test/${key}`,
      matchCode: 'b5',
      source: 'reporter',
      highlight: false,
    });

    const recorded = await post(`/reporter/${token}/events`, {
      clientEventId: 'photo-event-1',
      type: 'PHOTO',
      minute: 12,
      caption: 'Arrêt décisif',
      photoId: body.photoId,
    });
    expect(recorded.statusCode).toBe(200);
    const [latest] = (await feed()).events;
    expect(latest).toMatchObject({
      type: 'PHOTO',
      caption: 'Arrêt décisif',
      photo: { url: `https://media.test/${key}`, width: 1600, height: 1200 },
    });
    expect(await publicPhotos('?match=b5')).toHaveLength(1);
    expect(await publicPhotos('?match=a5')).toEqual([]);

    // Annuler l'événement retire aussi la photo et efface le fichier.
    await post(`/reporter/${token}/events`, {
      clientEventId: 'photo-cancel-1',
      type: 'CANCEL',
      minute: 12,
      cancels: 'photo-event-1',
    });
    expect(
      (await feed()).events.some((e) => e.caption === 'Arrêt décisif'),
    ).toBe(false);
    expect(await publicPhotos()).toEqual([]);
    expect(storage.removed).toContain(key);
    expect(await prisma.photo.count()).toBe(0);
  });

  it('refuse un fichier trop lourd, sans accord, ou qui n’est pas une photo', async () => {
    const token = await reporterToken();
    expect(
      (
        await post(
          `/reporter/${token}/photos`,
          photo({ bytes: 2 * 1024 * 1024 + 1 }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await post(`/reporter/${token}/photos`, photo({ consent: false })))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          `/reporter/${token}/photos`,
          photo({ contentType: 'image/png' }),
        )
      ).statusCode,
    ).toBe(400);

    // Annoncée en JPEG, arrivée en HTML : retirée.
    const { photoId } = (
      await post(`/reporter/${token}/photos`, photo())
    ).json<{
      photoId: string;
    }>();
    const key = storage.keys.at(-1)!;
    storage.put(key, 180_000, [0x3c, 0x68, 0x74, 0x6d, 0x6c], 'image/jpeg');
    const res = await post(`/reporter/${token}/photos/${photoId}/confirm`);
    expect(res.statusCode).toBe(422);
    expect(storage.removed).toContain(key);

    // Taille différente de celle signée : retirée aussi.
    const second = (await post(`/reporter/${token}/photos`, photo())).json<{
      photoId: string;
    }>();
    storage.put(storage.keys.at(-1)!, 999_999);
    expect(
      (await post(`/reporter/${token}/photos/${second.photoId}/confirm`))
        .statusCode,
    ).toBe(422);

    // Un événement ne peut joindre que sa propre photo, publiée.
    expect(
      (
        await post(`/reporter/${token}/events`, {
          clientEventId: 'photo-event-x',
          type: 'PHOTO',
          minute: 3,
          photoId: second.photoId,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(`/reporter/${token}/events`, {
          clientEventId: 'goal-photo-x',
          type: 'GOAL',
          side: 'home',
          minute: 3,
          photoId: second.photoId,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('limite les photos d’un match et ferme l’envoi sans stockage', async () => {
    const token = await reporterToken();
    const match = await prisma.match.findFirstOrThrow({
      where: { code: 'b5', tournament: { slug: SLUG } },
    });
    await prisma.photo.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        tournamentId: match.tournamentId,
        matchId: match.id,
        storageKey: `photos/x/${i}.jpg`,
        contentType: 'image/jpeg',
        bytes: 1000,
        width: 800,
        height: 600,
        source: 'REPORTER' as const,
        status: 'READY' as const,
      })),
    });
    expect((await post(`/reporter/${token}/photos`, photo())).statusCode).toBe(
      429,
    );
    storage.enabled = false;
    const club = await post(
      `/organizer/tournaments/${SLUG}/photos`,
      photo(),
      as(owner),
    );
    expect(club.statusCode).toBe(503);
    expect(club.headers['content-type']).toContain('application/problem+json');
  });

  it('le club envoie, met en avant et retire ses photos selon les rôles', async () => {
    const staff = await login(app, 'benevole@example.org');
    const admin = await login(app, 'admin@example.org');
    const upload = await post(
      `/organizer/tournaments/${SLUG}/photos`,
      photo({ caption: 'Remise des maillots', matchCode: 'a5' }),
      as(staff),
    );
    expect(upload.statusCode).toBe(200);
    const { photoId } = upload.json<{ photoId: string }>();
    storage.put(storage.keys.at(-1)!, 180_000);
    // Un autre membre ne confirme pas l'envoi d'un bénévole.
    expect(
      (
        await post(
          `/organizer/tournaments/${SLUG}/photos/${photoId}/confirm`,
          undefined,
          as(admin),
        )
      ).statusCode,
    ).toBe(404);
    const confirmed = await post(
      `/organizer/tournaments/${SLUG}/photos/${photoId}/confirm`,
      undefined,
      as(staff),
    );
    expect(confirmed.json()).toMatchObject({ source: 'club', matchCode: 'a5' });

    const listed = await get(
      `/organizer/tournaments/${SLUG}/photos`,
      as(staff),
    );
    expect(listed.json()).toEqual([
      expect.objectContaining({ id: photoId, uploadedBy: expect.any(String) }),
    ]);

    // Mise en avant : un admin seulement.
    const patch = (token: string, payload: object) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/organizer/tournaments/${SLUG}/photos/${photoId}`,
        headers: as(token),
        payload,
      });
    expect((await patch(staff, { highlight: true })).statusCode).toBe(404);
    const highlighted = await patch(admin, {
      highlight: true,
      caption: 'Les U13 avant la finale',
    });
    expect(highlighted.json()).toMatchObject({
      highlight: true,
      caption: 'Les U13 avant la finale',
    });
    expect(await publicPhotos('?highlights=true')).toEqual([
      expect.objectContaining({ id: photoId, highlight: true }),
    ]);

    // Hors du club : 404, jamais 403.
    const other = await login(app, 'multi@example.org');
    expect(
      (
        await get(`/organizer/tournaments/${SLUG}/photos`, {
          authorization: `Bearer ${other}`,
          'x-organization': 'stade-du-mont-blanc',
        })
      ).statusCode,
    ).toBe(404);

    // Un bénévole ne retire pas la photo d'un autre ; un admin, si.
    const del = (token: string) =>
      app.inject({
        method: 'DELETE',
        url: `/api/v1/organizer/tournaments/${SLUG}/photos/${photoId}`,
        headers: as(token),
      });
    expect((await del(other)).statusCode).toBe(404);
    expect((await del(admin)).statusCode).toBe(204);
    expect(await publicPhotos()).toEqual([]);
    expect(storage.removed).toHaveLength(1);
  });

  it('une photo signalée est masquée par la plateforme et son fichier effacé', async () => {
    const token = await reporterToken();
    const photoId = await reporterPhoto(token, 'Visage d’un enfant');
    const key = storage.keys.at(-1)!;
    const sent = mailbox.length;
    const reported = await post(`/public/tournaments/${SLUG}/reports`, {
      photoId,
      reason: 'PRIVACY',
      details: 'Mon fils est reconnaissable.',
    });
    expect(reported.statusCode).toBe(201);
    expect(
      (
        await post(`/public/tournaments/${SLUG}/reports`, {
          photoId,
          postId: 'x',
          reason: 'SPAM',
        })
      ).statusCode,
    ).toBe(400);

    const platform = await login(app, 'plateforme@example.org');
    const reports = await get('/platform/reports', {
      authorization: `Bearer ${platform}`,
    });
    const [open] =
      reports.json<
        { id: string; photo: { id: string; url: string | null } | null }[]
      >();
    expect(open!.photo).toEqual({
      id: photoId,
      url: `https://media.test/${key}`,
      caption: 'Visage d’un enfant',
      hidden: false,
    });
    const hidden = await post(`/platform/reports/${open!.id}/hide`, undefined, {
      authorization: `Bearer ${platform}`,
    });
    expect(hidden.statusCode).toBe(204);
    expect(await publicPhotos()).toEqual([]);
    expect(storage.removed).toContain(key);
    expect(mailbox.slice(sent)).toContainEqual(
      expect.objectContaining({
        to: 'orga@example.org',
        text: expect.stringContaining('une photo'),
      }),
    );
    const closed = await get('/platform/reports?status=HIDDEN', {
      authorization: `Bearer ${platform}`,
    });
    expect(closed.json<{ photo: object }[]>()[0]!.photo).toEqual({
      id: photoId,
      url: null,
      caption: 'Visage d’un enfant',
      hidden: true,
    });
  });

  it('retire les photos du club avec le compte et les liste dans l’export', async () => {
    const multi = await login(app, 'multi@example.org');
    const headers = as(multi);
    const { photoId } = (
      await post(`/organizer/tournaments/${SLUG}/photos`, photo(), headers)
    ).json<{ photoId: string }>();
    storage.put(storage.keys.at(-1)!, 180_000);
    await post(
      `/organizer/tournaments/${SLUG}/photos/${photoId}/confirm`,
      undefined,
      headers,
    );
    const exported = await get('/me/export', {
      authorization: `Bearer ${multi}`,
    });
    expect(exported.json<{ photos: object[] }>().photos).toEqual([
      expect.objectContaining({ tournament: SLUG }),
    ]);

    // Les comptes de démonstration ne se suppriment pas : on en crée un.
    const club = await prisma.organization.findUniqueOrThrow({
      where: { slug: ORG },
    });
    await prisma.user.deleteMany({ where: { email: 'parent@test.invalid' } });
    await prisma.user.create({
      data: {
        email: 'parent@test.invalid',
        memberships: {
          create: { organizationId: club.id, role: 'STAFF' },
        },
      },
    });
    const parent = await login(app, 'parent@test.invalid');
    const own = (
      await post(`/organizer/tournaments/${SLUG}/photos`, photo(), as(parent))
    ).json<{ photoId: string }>();
    const key = storage.keys.at(-1)!;
    storage.put(key, 180_000);
    await post(
      `/organizer/tournaments/${SLUG}/photos/${own.photoId}/confirm`,
      undefined,
      as(parent),
    );
    const deleted = await post(
      '/me/delete',
      { email: 'parent@test.invalid' },
      { authorization: `Bearer ${parent}` },
    );
    expect(deleted.statusCode).toBe(204);
    expect(storage.removed).toEqual([key]);
    expect((await publicPhotos()).map((p) => p.id)).toEqual([photoId]);
  });

  it('la purge efface les envois abandonnés et les photos des tournois anciens', async () => {
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    const base = {
      tournamentId: tournament.id,
      contentType: 'image/jpeg',
      bytes: 1000,
      width: 800,
      height: 600,
      source: 'CLUB' as const,
    };
    await prisma.photo.createMany({
      data: [
        {
          ...base,
          storageKey: 'photos/old-pending.jpg',
          createdAt: new Date(DEMO_NOW.getTime() - 2 * 86_400_000),
        },
        {
          ...base,
          storageKey: 'photos/fresh-pending.jpg',
          createdAt: DEMO_NOW,
        },
        { ...base, storageKey: 'photos/ready.jpg', status: 'READY' },
      ],
    });
    const media = app.get(MediaService);
    expect(await media.cleanup()).toEqual({ expired: 0, removed: 1 });
    expect(storage.removed).toEqual(['photos/old-pending.jpg']);

    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { endsAt: new Date(DEMO_NOW.getTime() - 366 * 86_400_000) },
    });
    expect(await media.cleanup()).toEqual({ expired: 2, removed: 2 });
    expect(await prisma.photo.count()).toBe(0);
  });
});
