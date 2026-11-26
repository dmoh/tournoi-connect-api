import type { MailMessage } from './mail-sender.js';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Code de connexion. Le code est dans l'objet : il se lit dans la
 * notification sans ouvrir l'email, et les téléphones le proposent au clavier.
 */
export function loginCodeMail(to: string, code: string): MailMessage {
  const subject = `${code} est votre code Tournoi Connect`;
  const text = [
    `Votre code de connexion : ${code}`,
    '',
    'Il est valable 10 minutes. Si vous n’avez rien demandé, ignorez cet email : personne ne peut se connecter sans ce code.',
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">Votre code de connexion</p>
<p style="margin:0 0 16px;font-size:36px;font-weight:700;letter-spacing:6px;color:#1e3a8a">${escape(code)}</p>
<p style="margin:0;font-size:14px;color:#5c6a7f">Il est valable 10 minutes. Si vous n’avez rien demandé, ignorez cet email : personne ne peut se connecter sans ce code.</p>
</div></body></html>`;
  return { to, subject, text, html };
}

const ROLE_LABEL = {
  OWNER: 'propriétaire',
  ADMIN: 'admin',
  STAFF: 'bénévole',
} as const;

/** Invitation à rejoindre un club : un bouton, valable 7 jours. */
export function invitationMail(
  to: string,
  invite: {
    club: string;
    invitedBy: string | null;
    role: keyof typeof ROLE_LABEL;
    url: string;
  },
): MailMessage {
  const who = invite.invitedBy ?? 'Un membre du club';
  const subject = `${who} vous invite à rejoindre ${invite.club} sur Tournoi Connect`;
  const role = ROLE_LABEL[invite.role];
  const text = [
    `${who} vous invite à rejoindre ${invite.club} en tant que ${role}.`,
    '',
    `Accepter l’invitation : ${invite.url}`,
    '',
    'Le lien est valable 7 jours et réservé à cette adresse. Si vous ne connaissez pas ce club, ignorez cet email.',
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">${escape(who)} vous invite à rejoindre</p>
<p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#1e3a8a">${escape(invite.club)}</p>
<p style="margin:0 0 20px;font-size:14px;color:#5c6a7f">en tant que ${escape(role)}</p>
<a href="${escape(invite.url)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 20px;border-radius:12px">Accepter l’invitation</a>
<p style="margin:20px 0 0;font-size:13px;color:#5c6a7f">Le lien est valable 7 jours et réservé à cette adresse. Si vous ne connaissez pas ce club, ignorez cet email.</p>
</div></body></html>`;
  return { to, subject, text, html };
}

/** Inscription confirmée (tournoi gratuit, ou paiement reçu). */
export function registrationConfirmedMail(
  to: string,
  info: { team: string; tournament: string; date: string; url: string },
): MailMessage {
  const subject = `${info.team} est inscrite au ${info.tournament}`;
  const text = [
    `L’inscription de ${info.team} au ${info.tournament} (${info.date}) est confirmée.`,
    '',
    `Suivre le tournoi : ${info.url}`,
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">Inscription confirmée</p>
<p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1e3a8a">${escape(info.team)}</p>
<p style="margin:0 0 20px;font-size:14px;color:#5c6a7f">${escape(info.tournament)} · ${escape(info.date)}</p>
<a href="${escape(info.url)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 20px;border-radius:12px">Suivre le tournoi</a>
</div></body></html>`;
  return { to, subject, text, html };
}

/**
 * Place libérée pour une équipe en liste d'attente d'un tournoi payant : elle
 * est tenue jusqu'à la date limite, le paiement se fait depuis Mes équipes.
 */
export function waitlistOfferMail(
  to: string,
  info: {
    team: string;
    tournament: string;
    date: string;
    amount: string;
    dueDate: string;
    url: string;
  },
): MailMessage {
  const subject = `Une place s’est libérée pour ${info.team} au ${info.tournament}`;
  const hold = `La place de ${info.team} au ${info.tournament} (${info.date}) est tenue jusqu’au ${info.dueDate}. Passé ce délai, elle est proposée à l’équipe suivante.`;
  const text = [
    hold,
    '',
    `Payer la place (${info.amount}) : ${info.url}`,
    '',
    'Rien n’est prélevé avant votre paiement. Si vous ne souhaitez plus participer, renoncez à la place depuis la même page.',
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">Une place s’est libérée</p>
<p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1e3a8a">${escape(info.team)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#5c6a7f">${escape(info.tournament)} · ${escape(info.date)}</p>
<p style="margin:0 0 20px;font-size:15px">${escape(hold)}</p>
<a href="${escape(info.url)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 20px;border-radius:12px">Payer la place (${escape(info.amount)})</a>
<p style="margin:20px 0 0;font-size:13px;color:#5c6a7f">Rien n’est prélevé avant votre paiement. Si vous ne souhaitez plus participer, renoncez à la place depuis la même page.</p>
</div></body></html>`;
  return { to, subject, text, html };
}

/**
 * Paiement reçu mais non retenu, intégralement remboursé : tournoi complet
 * entre-temps, ou second paiement d'une inscription déjà réglée.
 */
export function registrationRefundedMail(
  to: string,
  info: {
    team: string;
    tournament: string;
    amount: string;
    reason: 'full' | 'duplicate';
  },
): MailMessage {
  const subject =
    info.reason === 'full'
      ? `${info.tournament} est complet : votre paiement est remboursé`
      : `Paiement en double pour ${info.team} : il est remboursé`;
  const why =
    info.reason === 'full'
      ? `Le ${info.tournament} est devenu complet avant la confirmation de votre paiement : l’inscription de ${info.team} n’a pas pu être retenue.`
      : `L’inscription de ${info.team} au ${info.tournament} était déjà réglée : ce second paiement n’est pas retenu.`;
  const refund = `Votre paiement de ${info.amount} vous est intégralement remboursé. Il apparaît sur votre compte sous 5 à 10 jours selon votre banque.`;
  const text = [why, '', refund, '', 'Tournoi Connect'].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">Paiement remboursé</p>
<p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1e3a8a">${escape(info.team)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#5c6a7f">${escape(info.tournament)}</p>
<p style="margin:0 0 12px;font-size:15px">${escape(why)}</p>
<p style="margin:0;font-size:14px;color:#5c6a7f">${escape(refund)}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

/** Confirmation de la suppression du compte (RGPD, droit à l'effacement). */
export function accountDeletedMail(to: string): MailMessage {
  const subject = 'Votre compte Tournoi Connect est supprimé';
  const body =
    'Votre compte et vos données personnelles ont été supprimés. Les inscriptions d’équipe confirmées restent aux tournois concernés, sans votre nom ni votre téléphone.';
  const text = [
    body,
    '',
    'Si vous n’êtes pas à l’origine de cette suppression, répondez à cet email.',
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1e3a8a">Compte supprimé</p>
<p style="margin:0 0 12px;font-size:15px">${escape(body)}</p>
<p style="margin:0;font-size:14px;color:#5c6a7f">Si vous n’êtes pas à l’origine de cette suppression, répondez à cet email.</p>
</div></body></html>`;
  return { to, subject, text, html };
}

const REASON_LABEL = {
  ILLEGAL: 'contenu illicite',
  ABUSE: 'propos injurieux ou harcèlement',
  PRIVACY: 'atteinte à la vie privée',
  SPAM: 'publicité abusive ou arnaque',
  OTHER: 'autre motif',
} as const;

/** Nouveau signalement, pour les admins de la plateforme. */
export function reportReceivedMail(
  to: string,
  report: {
    tournament: string;
    reason: keyof typeof REASON_LABEL;
    url: string;
  },
): MailMessage {
  const reason = REASON_LABEL[report.reason];
  const subject = `Signalement : ${report.tournament} (${reason})`;
  const text = [
    `Un contenu du tournoi « ${report.tournament} » a été signalé : ${reason}.`,
    '',
    `Traiter le signalement : ${report.url}`,
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">Nouveau signalement : ${escape(reason)}</p>
<p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#1e3a8a">${escape(report.tournament)}</p>
<a href="${escape(report.url)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">Traiter le signalement</a>
</div></body></html>`;
  return { to, subject, text, html };
}

/** Contenu masqué par la modération, pour les propriétaires du club. */
export function contentHiddenMail(
  to: string,
  hidden: { club: string; tournament: string; what: string },
): MailMessage {
  const subject = `Contenu masqué par la modération : ${hidden.club}`;
  const body = `Suite à un signalement, ${hidden.what} (${hidden.tournament}) a été masqué par la modération de Tournoi Connect.`;
  const text = [
    body,
    '',
    'Si vous pensez qu’il s’agit d’une erreur, répondez à cet email en expliquant le contexte : nous réexaminerons la décision.',
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;font-size:15px">${escape(body)}</p>
<p style="margin:0;font-size:14px;color:#5c6a7f">Si vous pensez qu’il s’agit d’une erreur, répondez à cet email en expliquant le contexte : nous réexaminerons la décision.</p>
</div></body></html>`;
  return { to, subject, text, html };
}

/** Montant en euros (« 963,00 € »), comme sur la page de paiement. */
export const eurosLabel = (cents: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    cents / 100,
  );

const TIER_NAME = {
  GOLD: 'Or',
  SILVER: 'Argent',
  BRONZE: 'Bronze',
  FIELD: 'Terrain',
} as const;

function sponsorCard(
  title: string,
  lines: readonly string[],
  button?: { label: string; url: string },
): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">${escape(title)}</p>
${lines.map((l, i) => `<p style="margin:0 0 ${i === lines.length - 1 ? 20 : 6}px;font-size:${i === 0 ? 20 : 14}px;${i === 0 ? 'font-weight:700;color:#1e3a8a' : 'color:#5c6a7f'}">${escape(l)}</p>`).join('\n')}
${button ? `<a href="${escape(button.url)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 20px;border-radius:12px">${escape(button.label)}</a>` : ''}
</div></body></html>`;
}

/** Invitation d'un sponsor à régler son pack en ligne (lien personnel). */
export function sponsorInvitationMail(
  to: string,
  info: {
    club: string;
    tournament: string;
    sponsor: string;
    tier: keyof typeof TIER_NAME;
    totalCents: number;
    url: string;
  },
): MailMessage {
  const pack = `Pack ${TIER_NAME[info.tier]}`;
  const subject = `${info.club} vous propose le ${pack} du ${info.tournament}`;
  const text = [
    `${info.club} invite ${info.sponsor} à soutenir le ${info.tournament} avec le ${pack}.`,
    `Montant : ${eurosLabel(info.totalCents)}, frais de service compris.`,
    '',
    `Voir le pack et payer en ligne : ${info.url}`,
    '',
    'Le paiement est sécurisé par Stripe et versé au club. Ce lien vous est personnel.',
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = sponsorCard(
    `${info.club} vous invite`,
    [
      pack,
      info.tournament,
      `${eurosLabel(info.totalCents)}, frais de service compris`,
    ],
    { label: 'Voir le pack et payer', url: info.url },
  );
  return { to, subject, text, html };
}

/** Reçu du paiement en ligne d'un pack sponsor (le vendeur est le club). */
export function sponsorReceiptMail(
  to: string,
  info: {
    club: string;
    tournament: string;
    sponsor: string;
    tier: keyof typeof TIER_NAME;
    amountCents: number;
    serviceFeeCents: number;
    date: string;
    url: string;
    /** Lien de la facture du club, émise avec le paiement ; sinon null. */
    invoiceUrl?: string | null;
  },
): MailMessage {
  const pack = `Pack ${TIER_NAME[info.tier]}`;
  const invoiceLine = info.invoiceUrl
    ? `La facture du club pour votre pack : ${info.invoiceUrl}`
    : 'Ce reçu n’est pas une facture : le club vous l’enverra dès qu’elle sera établie.';
  const total = info.amountCents + info.serviceFeeCents;
  const subject = `Reçu : ${pack} du ${info.tournament}`;
  const lines = [
    `${pack} · ${info.tournament}`,
    `Sponsor : ${info.sponsor}`,
    `Vendu par : ${info.club}`,
    `Pack : ${eurosLabel(info.amountCents)}`,
    `Frais de service Tournoi Connect : ${eurosLabel(info.serviceFeeCents)}`,
    `Total payé le ${info.date} : ${eurosLabel(total)}`,
  ];
  const text = [
    'Merci pour votre soutien : votre paiement est bien reçu.',
    '',
    ...lines,
    '',
    `Votre pack sur la page du tournoi : ${info.url}`,
    '',
    invoiceLine,
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = sponsorCard(
    'Paiement reçu, merci !',
    [
      ...lines,
      info.invoiceUrl
        ? 'La facture du club est prête.'
        : 'Ce reçu n’est pas une facture : le club vous l’enverra dès qu’elle sera établie.',
    ],
    info.invoiceUrl
      ? { label: 'Voir la facture', url: info.invoiceUrl }
      : { label: 'Voir le tournoi', url: info.url },
  );
  return { to, subject, text, html };
}

/** Facture du club envoyée au sponsor (émise après coup ou à sa demande). */
export function sponsorInvoiceMail(
  to: string,
  info: {
    club: string;
    tournament: string;
    number: string;
    totalCents: number;
    url: string;
  },
): MailMessage {
  const subject = `Facture ${info.number} : ${info.club}`;
  const lines = [
    `Facture ${info.number}`,
    `Émise par : ${info.club}`,
    `Partenariat : ${info.tournament}`,
    `Montant acquitté : ${eurosLabel(info.totalCents)}`,
  ];
  const text = [
    'Bonjour,',
    '',
    `Voici la facture de ${info.club} pour votre partenariat.`,
    '',
    ...lines,
    '',
    `Consulter, imprimer ou enregistrer en PDF : ${info.url}`,
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = sponsorCard('Votre facture', lines, {
    label: 'Voir la facture',
    url: info.url,
  });
  return { to, subject, text, html };
}

/** Avis au club : un sponsor a payé son pack en ligne. */
export function sponsorPaidClubMail(
  to: string,
  info: {
    sponsor: string;
    tournament: string;
    tier: keyof typeof TIER_NAME;
    amountCents: number;
    url: string;
    /** Numéro de la facture émise avec le paiement, null si elle attend le club. */
    invoiceNumber?: string | null;
  },
): MailMessage {
  const pack = `Pack ${TIER_NAME[info.tier]}`;
  const subject = `${info.sponsor} a payé le ${pack} du ${info.tournament}`;
  const invoiceLine = info.invoiceNumber
    ? `La facture ${info.invoiceNumber} lui a été envoyée.`
    : 'Pour lui envoyer sa facture, complétez l’identité de facturation du club (Paiements), puis « Établir la facture ».';
  const text = [
    `${info.sponsor} a payé en ligne le ${pack} du ${info.tournament} (${eurosLabel(info.amountCents)} pour le club).`,
    'Son logo s’affiche maintenant sur la page du tournoi.',
    invoiceLine,
    '',
    `Vos sponsors : ${info.url}`,
    '',
    'Tournoi Connect',
  ].join('\n');
  const html = sponsorCard(
    'Sponsor payé',
    [
      info.sponsor,
      `${pack} · ${info.tournament}`,
      `${eurosLabel(info.amountCents)} pour le club`,
    ],
    { label: 'Voir mes sponsors', url: info.url },
  );
  return { to, subject, text, html };
}

const REFUND_DELAY =
  'Il apparaît sur votre compte sous 5 à 10 jours selon votre banque.';

/** Gabarit commun des annulations par le club (désistement, tournoi annulé). */
function cancellationMail(
  to: string,
  subject: string,
  info: { heading: string; team: string; tournament: string; lines: string[] },
): MailMessage {
  const text = [...info.lines.flatMap((l) => [l, '']), 'Tournoi Connect'].join(
    '\n',
  );
  const paragraphs = info.lines
    .map(
      (l, i) =>
        `<p style="margin:0 0 12px;font-size:${i === 0 ? 15 : 14}px${i === 0 ? '' : ';color:#5c6a7f'}">${escape(l)}</p>`,
    )
    .join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 8px;font-size:15px">${escape(info.heading)}</p>
<p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1e3a8a">${escape(info.team)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#5c6a7f">${escape(info.tournament)}</p>
${paragraphs}
</div></body></html>`;
  return { to, subject, text, html };
}

/** Équipe désistée par l'organisateur, remboursée ou non. */
export function registrationWithdrawnMail(
  to: string,
  info: { team: string; tournament: string; refund: string | null },
): MailMessage {
  return cancellationMail(
    to,
    `Inscription de ${info.team} annulée au ${info.tournament}`,
    {
      heading: 'Inscription annulée',
      team: info.team,
      tournament: info.tournament,
      lines: [
        `L’organisateur du ${info.tournament} a annulé l’inscription de ${info.team}.`,
        info.refund
          ? `Votre paiement de ${info.refund} vous est intégralement remboursé. ${REFUND_DELAY}`
          : 'Aucun remboursement n’est prévu : pour toute question, répondez à l’organisateur du tournoi.',
      ],
    },
  );
}

/** Tournoi annulé par le club : motif, et remboursement s'il y a eu paiement. */
export function tournamentCancelledMail(
  to: string,
  info: {
    team: string;
    tournament: string;
    date: string;
    reason: string;
    refund: string | null;
  },
): MailMessage {
  return cancellationMail(to, `${info.tournament} est annulé`, {
    heading: 'Tournoi annulé',
    team: info.team,
    tournament: `${info.tournament} · ${info.date}`,
    lines: [
      `Le club organisateur a annulé le ${info.tournament}. Motif : ${info.reason}`,
      info.refund
        ? `Votre paiement de ${info.refund} vous est intégralement remboursé. ${REFUND_DELAY}`
        : 'Vous n’aviez rien payé : aucune démarche n’est nécessaire.',
    ],
  });
}
