import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login, mailbox } from './setup-app.js';

describe('Clubs, membres et invitations (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(() => reset());
  afterAll(() => app.close());

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    token?: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(payload ? { payload } : {}),
    });

  /** Jeton du dernier lien d'invitation reçu par cette adresse. */
  const invitationToken = (email: string) =>
    /\/invite\/([\w-]+)/.exec(
      mailbox.findLast((m) => m.to === email)!.text,
    )![1]!;

  it('crée un club dont on devient propriétaire, au nom unique', async () => {
    const token = await login(app, 'nouveau.club@example.com');
    const created = await call('POST', '/clubs', token, {
      name: "  Étoile de l'Arve ",
      city: 'Cluses',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().memberships).toEqual([
      {
        organization: { slug: 'etoile-de-l-arve-2', name: "Étoile de l'Arve" },
        role: 'OWNER',
      },
    ]);
    const members = await call('GET', '/organizer/members', token);
    expect(members.json()).toMatchObject({
      organization: { slug: 'etoile-de-l-arve-2', city: 'Cluses' },
      yourRole: 'OWNER',
      items: [{ email: 'nouveau.club@example.com', role: 'OWNER', you: true }],
      nextCursor: null,
      invitations: [],
    });
    expect(
      (await call('POST', '/clubs', undefined, { name: 'X' })).statusCode,
    ).toBe(401);
  });

  it('invite par email, puis le compte de l’adresse invitée rejoint le club', async () => {
    const owner = await login(app, 'orga@example.org');
    const invited = await call('POST', '/organizer/invitations', owner, {
      email: ' Lea.Martin@Example.com ',
      role: 'STAFF',
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json().invitations).toEqual([
      expect.objectContaining({
        email: 'lea.martin@example.com',
        role: 'STAFF',
        invitedBy: 'Camille Perrin',
      }),
    ]);
    const mail = mailbox.findLast((m) => m.to === 'lea.martin@example.com')!;
    expect(mail.subject).toBe(
      "Camille Perrin vous invite à rejoindre Étoile de l'Arve sur Tournoi Connect",
    );
    const token = invitationToken('lea.martin@example.com');

    // Le lien se lit sans connexion ; l'adresse y est masquée.
    const read = await call('GET', `/invitations/${token}`);
    expect(read.json()).toMatchObject({
      organization: { slug: 'etoile-de-l-arve', name: "Étoile de l'Arve" },
      role: 'STAFF',
      email: 'l•••@example.com',
      invitedBy: 'Camille Perrin',
      status: 'PENDING',
    });

    // Un autre compte ne peut pas l'utiliser.
    const other = await login(app, 'spectateur@example.org');
    const wrong = await call('POST', `/invitations/${token}/accept`, other);
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().detail).toContain('l•••@example.com');

    const lea = await login(app, 'lea.martin@example.com');
    const accepted = await call('POST', `/invitations/${token}/accept`, lea);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().memberships).toEqual([
      {
        organization: { slug: 'etoile-de-l-arve', name: "Étoile de l'Arve" },
        role: 'STAFF',
      },
    ]);
    expect((await call('GET', `/invitations/${token}`)).json().status).toBe(
      'ACCEPTED',
    );
    expect(
      (await call('POST', `/invitations/${token}/accept`, lea)).statusCode,
    ).toBe(404);
    expect((await call('GET', '/invitations/inconnu')).statusCode).toBe(404);
  });

  it('remplace, annule et limite les invitations selon le rôle', async () => {
    const owner = await login(app, 'orga@example.org');
    await call('POST', '/organizer/invitations', owner, {
      email: 'tom@example.com',
      role: 'STAFF',
    });
    const first = invitationToken('tom@example.com');
    const again = await call('POST', '/organizer/invitations', owner, {
      email: 'tom@example.com',
      role: 'ADMIN',
    });
    expect(again.json().invitations).toHaveLength(1);
    expect((await call('GET', `/invitations/${first}`)).json().status).toBe(
      'REVOKED',
    );

    const id = again.json().invitations[0].id as string;
    expect(
      (await call('DELETE', `/organizer/invitations/${id}`, owner)).statusCode,
    ).toBe(204);
    expect(
      (await call('DELETE', `/organizer/invitations/${id}`, owner)).statusCode,
    ).toBe(404);

    // Déjà membre.
    expect(
      (
        await call('POST', '/organizer/invitations', owner, {
          email: 'benevole@example.org',
          role: 'ADMIN',
        })
      ).statusCode,
    ).toBe(409);

    // Un admin invite un bénévole ou un admin, pas un propriétaire ; un bénévole n'invite pas.
    const admin = await login(app, 'admin@example.org');
    expect(
      (
        await call('POST', '/organizer/invitations', admin, {
          email: 'a@example.com',
          role: 'ADMIN',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call('POST', '/organizer/invitations', admin, {
          email: 'b@example.com',
          role: 'OWNER',
        })
      ).statusCode,
    ).toBe(404);
    const staff = await login(app, 'benevole@example.org');
    expect(
      (
        await call('POST', '/organizer/invitations', staff, {
          email: 'c@example.com',
          role: 'STAFF',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/organizer/members', staff)).json().yourRole,
    ).toBe('STAFF');

    // Une invitation expirée ne sert plus.
    await prisma.invitation.updateMany({
      data: { expiresAt: new Date('2026-01-01') },
    });
    const token = invitationToken('a@example.com');
    expect((await call('GET', `/invitations/${token}`)).json().status).toBe(
      'EXPIRED',
    );
  });

  it('change les rôles et garde toujours un propriétaire', async () => {
    const owner = await login(app, 'orga@example.org');
    const members = (await call('GET', '/organizer/members', owner)).json();
    const id = (email: string) =>
      members.items.find((m: { email: string }) => m.email === email)
        .userId as string;

    const promoted = await call(
      'PATCH',
      `/organizer/members/${id('benevole@example.org')}`,
      owner,
      {
        role: 'ADMIN',
      },
    );
    expect(promoted.statusCode).toBe(200);
    expect(
      promoted
        .json()
        .items.find(
          (m: { email: string }) => m.email === 'benevole@example.org',
        ).role,
    ).toBe('ADMIN');

    // Dernier propriétaire : ni rétrogradé, ni retiré.
    const self = id('orga@example.org');
    expect(
      (
        await call('PATCH', `/organizer/members/${self}`, owner, {
          role: 'ADMIN',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call('DELETE', `/organizer/members/${self}`, owner)).statusCode,
    ).toBe(400);

    // Un admin ne change pas les rôles et ne retire pas un autre admin.
    const admin = await login(app, 'admin@example.org');
    expect(
      (
        await call(
          'PATCH',
          `/organizer/members/${id('benevole@example.org')}`,
          admin,
          {
            role: 'STAFF',
          },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'DELETE',
          `/organizer/members/${id('benevole@example.org')}`,
          admin,
        )
      ).statusCode,
    ).toBe(404);

    // Le propriétaire retire ; chacun peut quitter le club.
    expect(
      (
        await call(
          'DELETE',
          `/organizer/members/${id('benevole@example.org')}`,
          owner,
        )
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await call(
          'DELETE',
          `/organizer/members/${id('admin@example.org')}`,
          admin,
        )
      ).statusCode,
    ).toBe(204);
    expect((await call('GET', '/organizer/members', admin)).statusCode).toBe(
      404,
    );
  });
});
