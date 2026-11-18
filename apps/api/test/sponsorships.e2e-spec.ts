import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { signStripePayload } from '../src/payments/stripe-signature.js';
import { STRIPE } from '../src/registrations/registrations.tokens.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

/** Faux Stripe : garde les pages de paiement demandées, sans réseau. */
class FakeStripe {
  enabled = true;
  livemode = false;
  sessions: {
    id: string;
    destination: string;
    fee: number;
    total: number;
    metadata: Record<string, string>;
  }[] = [];
  createCheckoutSession = vi.fn(
    (input: {
      destination: string;
      applicationFeeCents: number;
      lines: { amountCents: number }[];
      metadata: Record<string, string>;
    }) => {
      const id = `cs_sponsor_${this.sessions.length + 1}`;
      this.sessions.push({
        id,
        destination: input.destination,
        fee: input.applicationFeeCents,
        total: input.lines.reduce((sum, l) => sum + l.amountCents, 0),
        metadata: input.metadata,
      });
      return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
    },
  );
}

const SLUG = 'challenge-u13-arve';

describe('Paiement en ligne des packs sponsors (e2e)', () => {
  const WEBHOOK_SECRET = `whsec_${randomBytes(16).toString('hex')}`;
  const stripe = new FakeStripe();
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let token: string;

  beforeAll(async () => {
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    const ctx = await createTestApp([{ provide: STRIPE, useValue: stripe }]);
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    await prisma.stripeEvent.deleteMany();
    stripe.sessions = [];
    await prisma.organization.update({
      where: { slug: 'etoile-de-l-arve' },
      data: { stripeAccountId: 'acct_etoile', stripeChargesEnabled: true },
    });
    token = await login(app);
  });
  afterAll(async () => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    await app.close();
  });

  const organizer = (
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    as = token,
  ) =>
    app.inject({
      method,
      url: `/api/v1/organizer${url}`,
      headers: {
        authorization: `Bearer ${as}`,
        'x-organization': 'etoile-de-l-arve',
      },
      ...(payload ? { payload } : {}),
    });
  const invitation = (link: string) =>
    `/api/v1/public/sponsor-invitations/${link.split('/sponsor/')[1]}`;
  const NOW_SECONDS = Math.floor(DEMO_NOW.getTime() / 1000);
  const webhook = (object: Record<string, unknown>) => {
    const body = JSON.stringify({
      id: `evt_${randomBytes(8).toString('hex')}`,
      type: 'checkout.session.completed',
      created: NOW_SECONDS,
      livemode: false,
      data: { object },
    });
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/stripe/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(
          body,
          WEBHOOK_SECRET,
          NOW_SECONDS,
        ),
      },
      payload: body,
    });
  };

  /** Nouveau sponsor invité sur le pack Bronze (150 €). */
  const inviteTraiteur = async () => {
    const res = await organizer('POST', `/tournaments/${SLUG}/sponsors`, {
      name: 'Traiteur du Lac',
      email: 'contact@traiteur.test',
      tier: 'BRONZE',
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; inviteUrl: string; emailed: boolean }>();
  };

  it('le sponsor invité paie son pack en ligne, frais de service en plus, versé au club', async () => {
    const sent = mailbox.length;
    const invited = await inviteTraiteur();
    expect(invited.emailed).toBe(true);
    expect(invited.inviteUrl).toMatch(/\/sponsor\/[\w-]{32}$/);
    expect(mailbox.slice(sent)).toContainEqual(
      expect.objectContaining({
        to: 'contact@traiteur.test',
        text: expect.stringContaining(invited.inviteUrl),
      }),
    );

    const view = await app.inject({
      method: 'GET',
      url: invitation(invited.inviteUrl),
    });
    expect(view.statusCode).toBe(200);
    // 150 € + 7 % (10,50 €) + 0,50 €.
    expect(view.json()).toMatchObject({
      club: "Étoile de l'Arve",
      sponsor: { name: 'Traiteur du Lac' },
      tier: 'BRONZE',
      priceCents: 15000,
      serviceFeeCents: 1100,
      totalCents: 16100,
      status: 'INVITED',
      paymentsReady: true,
    });

    const checkout = await app.inject({
      method: 'POST',
      url: `${invitation(invited.inviteUrl)}/checkout`,
      payload: { email: 'Compta@Traiteur.test' },
    });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().url).toBe(
      'https://checkout.stripe.test/cs_sponsor_1',
    );
    expect(stripe.sessions[0]).toMatchObject({
      destination: 'acct_etoile',
      fee: 1100,
      total: 16100,
      metadata: { sponsorship: invited.id, tournament: SLUG },
    });

    // Montant différent de celui attendu : rien n'est marqué payé.
    const session = {
      id: 'cs_sponsor_1',
      payment_status: 'paid',
      payment_intent: 'pi_sponsor_1',
      amount_total: 16100,
      currency: 'eur',
      livemode: false,
      customer_details: { email: 'compta@traiteur.test' },
      metadata: { sponsorship: invited.id },
    };
    await webhook({ ...session, amount_total: 100 });
    expect(
      (
        await prisma.tournamentSponsor.findUniqueOrThrow({
          where: { id: invited.id },
        })
      ).status,
    ).toBe('INVITED');

    const before = mailbox.length;
    expect((await webhook(session)).statusCode).toBe(200);
    const row = await prisma.tournamentSponsor.findUniqueOrThrow({
      where: { id: invited.id },
    });
    expect(row).toMatchObject({
      status: 'PAID',
      paymentIntentId: 'pi_sponsor_1',
    });
    const mails = mailbox.slice(before);
    expect(mails).toContainEqual(
      expect.objectContaining({
        to: 'compta@traiteur.test',
        subject: "Reçu : Pack Bronze du Challenge U13 de l'Arve",
        text: expect.stringContaining('Total payé le 9 novembre 2026 : 161,00'),
      }),
    );
    expect(mails).toContainEqual(
      expect.objectContaining({ to: 'orga@example.org' }),
    );

    // Le logo apparaît sur la page publique ; la page de paiement le dit.
    const publicSponsors = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/public/tournaments/${SLUG}/sponsors`,
      })
    ).json();
    expect(
      publicSponsors.rotation.map((s: { name: string }) => s.name),
    ).toContain('Traiteur du Lac');
    expect(
      (
        await app.inject({ method: 'GET', url: invitation(invited.inviteUrl) })
      ).json(),
    ).toMatchObject({
      status: 'PAID',
      totalCents: 16100,
    });
    const list = (
      await organizer('GET', `/tournaments/${SLUG}/sponsors`)
    ).json();
    expect(
      list.sponsors.find((s: { id: string }) => s.id === invited.id),
    ).toMatchObject({
      status: 'PAID',
      paidOnline: true,
    });
    // Un second paiement est refusé.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${invitation(invited.inviteUrl)}/checkout`,
          payload: { email: 'compta@traiteur.test' },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('renvoie un nouveau lien : l’ancien ne marche plus', async () => {
    const invited = await inviteTraiteur();
    const again = await organizer(
      'POST',
      `/tournament-sponsors/${invited.id}/invite-link`,
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().url).not.toBe(invited.inviteUrl);
    expect(
      (await app.inject({ method: 'GET', url: invitation(invited.inviteUrl) }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: invitation(again.json().url) }))
        .statusCode,
    ).toBe(200);
    // Lien d'un sponsor sans adresse : rien ne part, le club le transmet.
    const menuiserie = await prisma.tournamentSponsor.findFirstOrThrow({
      where: { sponsor: { name: 'Menuiserie des Bornes' } },
    });
    expect(
      (
        await organizer(
          'POST',
          `/tournament-sponsors/${menuiserie.id}/invite-link`,
        )
      ).json(),
    ).toMatchObject({
      emailed: false,
    });
    // Hors du club : 404, jamais 403 ; sponsor déjà payé : pas de lien.
    const other = await login(app, 'multi@example.org');
    const outside = await app.inject({
      method: 'POST',
      url: `/api/v1/organizer/tournament-sponsors/${invited.id}/invite-link`,
      headers: {
        authorization: `Bearer ${other}`,
        'x-organization': 'stade-du-mont-blanc',
      },
    });
    expect(outside.statusCode).toBe(404);
    const paid = await prisma.tournamentSponsor.findFirstOrThrow({
      where: { status: 'PAID' },
    });
    expect(
      (await organizer('POST', `/tournament-sponsors/${paid.id}/invite-link`))
        .statusCode,
    ).toBe(409);
  });

  it('sans paiement en ligne activé par le club, la page le dit et refuse de payer', async () => {
    const invited = await inviteTraiteur();
    await prisma.organization.update({
      where: { slug: 'etoile-de-l-arve' },
      data: { stripeChargesEnabled: false },
    });
    expect(
      (
        await app.inject({ method: 'GET', url: invitation(invited.inviteUrl) })
      ).json().paymentsReady,
    ).toBe(false);
    const checkout = await app.inject({
      method: 'POST',
      url: `${invitation(invited.inviteUrl)}/checkout`,
      payload: { email: 'compta@traiteur.test' },
    });
    expect(checkout.statusCode).toBe(503);
    expect(stripe.createCheckoutSession).not.toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ sponsorship: invited.id }),
      }),
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/public/sponsor-invitations/inconnu',
        })
      ).statusCode,
    ).toBe(404);
  });
});
