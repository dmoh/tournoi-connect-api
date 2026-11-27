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

/** Nom du pack comme dans l'app : « Pack Or », « Sponsor de terrain ». */
export function packLabel(tier: keyof typeof TIER_NAME): string {
  return tier === 'FIELD' ? 'Sponsor de terrain' : `Pack ${TIER_NAME[tier]}`;
}

function sponsorCard(
  title: string,
  lines: readonly string[],
  button?: { label: string; url: string },
): string {
  // Carte de 420 px fixée pour Outlook (moteur Word) par une table fantôme ;
  // bouton en cellule colorée, cliquable en entier ; thème clair imposé.
  const rows = lines
    .map(
      (l, i) =>
        `<p style="margin:0 0 ${i === lines.length - 1 ? 20 : 6}px;font-size:${i === 0 ? 20 : 14}px;${i === 0 ? 'font-weight:700;color:#1e3a8a' : 'color:#5c6a7f'}">${escape(l)}</p>`,
    )
    .join('\n');
  const cta = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1e3a8a" style="border-radius:12px"><a href="${escape(button.url)}" style="display:inline-block;padding:14px 20px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${escape(button.label)}</a></td></tr></table>`
    : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f8fa"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="420" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:420px;background:#ffffff;border-radius:16px"><tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:15px">${escape(title)}</p>
${rows}
${cta}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
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
  const pack = packLabel(info.tier);
  const subject = `${info.club} vous propose ${pack} – ${info.tournament}`;
  const text = [
    `${info.club} invite ${info.sponsor} à soutenir « ${info.tournament} » (${pack}).`,
    `Montant\u202f: ${eurosLabel(info.totalCents)}, frais de service compris.`,
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

/**
 * Convocation d'une équipe (48 h avant, envoyée par le club, ou renvoyée
 * après un changement d'horaires) : programme, lieu avec l'itinéraire, et
 * l'agenda en un appui (page de l'app qui choisit l'agenda de l'appareil).
 * Mise en page en tableaux : Outlook (moteur Word) ignore marges et rayons
 * des blocs.
 */
export function convocationMail(
  to: string,
  info: {
    team: string;
    tournament: string;
    date: string;
    venue: string;
    directionsUrl: string;
    /** Matchs de l'équipe (« 9 h 30 · Terrain 1 · contre Les Marmottes »). */
    matches: string[];
    /** Début du tournoi, si aucun match n'est encore programmé. */
    start: string;
    agendaUrl: string;
    /** Jour J : page « Nous sommes arrivés », sans connexion. */
    arrivalUrl: string;
    pageUrl: string;
    /** Renvoi après un changement d'horaires. */
    update: boolean;
  },
): MailMessage {
  const subject = info.update
    ? `Horaires modifiés : ${info.team} au ${info.tournament}, ${info.date}`
    : `Convocation : ${info.team} au ${info.tournament}, ${info.date}`;
  const intro = info.update
    ? `Les horaires de votre équipe ${info.team} ont changé. Voici le programme à jour.`
    : `Votre équipe ${info.team} est attendue au ${info.tournament}, ${info.date}.`;
  const programme =
    info.matches.length > 0
      ? info.matches
      : [
          `Début du tournoi à ${info.start}. Les horaires des matchs s’ajoutent à votre agenda dès leur publication.`,
        ];
  const text = [
    intro,
    '',
    info.matches.length > 1 ? 'Vos matchs :' : 'Votre programme :',
    ...programme.map((m) => `- ${m}`),
    '',
    `Lieu : ${info.venue}`,
    `Itinéraire : ${info.directionsUrl}`,
    '',
    `Ajouter à mon agenda : ${info.agendaUrl}`,
    `Le jour J, signalez votre arrivée ici : ${info.arrivalUrl}`,
    `Le tournoi en direct : ${info.pageUrl}`,
    '',
    'Tournoi Connect',
  ].join('\n');
  const rows = programme
    .map(
      (m, i) =>
        `<li style="margin:0 0 6px;${i === 0 ? 'font-weight:700;' : ''}">${escape(m)}</li>`,
    )
    .join('');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f8fa"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="420" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:420px;background:#ffffff;border-radius:16px"><tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:15px">${info.update ? 'Horaires modifiés' : 'Convocation'}</p>
<p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1e3a8a">${escape(info.team)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#5c6a7f">${escape(info.tournament)} · ${escape(info.date)}</p>
<p style="margin:0 0 12px;font-size:15px">${escape(intro)}</p>
<ul style="margin:0 0 16px;padding-left:20px;font-size:15px">${rows}</ul>
<p style="margin:0 0 20px;font-size:14px">${escape(info.venue)} · <a href="${escape(info.directionsUrl)}" style="color:#1e3a8a">Itinéraire</a></p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1e3a8a" style="border-radius:12px;padding:14px 20px"><a href="${escape(info.agendaUrl)}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">Ajouter à mon agenda</a></td></tr></table>
<p style="margin:16px 0 0;font-size:14px">Le jour J, <a href="${escape(info.arrivalUrl)}" style="color:#1e3a8a;font-weight:600">signalez votre arrivée ici</a> : l’organisateur saura que vous êtes là.</p>
<p style="margin:12px 0 0;font-size:13px;color:#5c6a7f"><a href="${escape(info.pageUrl)}" style="color:#1e3a8a">Suivre le tournoi en direct</a></p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  return { to, subject, text, html };
}

/**
 * Nouvelle édition d'un tournoi : le responsable d'une équipe inscrite à
 * l'édition précédente inscrit son équipe en un appui. Envoyé une seule fois,
 * quand le club publie l'édition suivante ; chaque email porte son lien de
 * désinscription (et l'en-tête List-Unsubscribe en un clic).
 * Carte de 420 px fixée pour Outlook (moteur Word) par une table fantôme.
 */
export function editionInviteMail(
  to: string,
  info: {
    tournament: string;
    previous: string;
    club: string;
    /** « lundi 8 novembre 2027 » */
    date: string;
    venue: string;
    /** « vendredi 29 octobre 2027 », ou null sans date de clôture. */
    deadline: string | null;
    /** « 60 € par équipe », « Inscription gratuite » */
    fee: string;
    joinUrl: string;
    /** Page de désinscription (lien de l'email). */
    unsubscribeUrl: string;
    /** Désinscription en un clic (POST, RFC 8058). */
    oneClickUrl: string;
  },
): MailMessage {
  const subject = `${info.club} – ${info.tournament}\u202f: inscriptions ouvertes`;
  const intro = `Votre équipe était inscrite à « ${info.previous} ». ${info.club} organise la nouvelle édition et vous invite à y inscrire votre équipe.`;
  const why = `Vous recevez cet email car vous avez inscrit une équipe à « ${info.previous} ». ${info.club} ne vous écrit qu’à la publication d’une nouvelle édition.`;
  const details = [
    `Date\u202f: ${info.date}`,
    `Lieu\u202f: ${info.venue}`,
    ...(info.deadline ? [`Inscriptions jusqu’au ${info.deadline}`] : []),
    info.fee,
  ];
  const text = [
    intro,
    '',
    ...details,
    '',
    `Inscrire mon équipe\u202f: ${info.joinUrl}`,
    '',
    why,
    `Ne plus recevoir les nouvelles éditions de ce club\u202f: ${info.unsubscribeUrl}`,
    '',
    'Tournoi Connect',
  ].join('\n');
  const rows = details
    .map((line) => `<li style="margin:0 0 6px">${escape(line)}</li>`)
    .join('');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f8fa"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="420" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:420px;background:#ffffff;border-radius:16px"><tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:15px">Nouvelle édition · ${escape(info.club)}</p>
<p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1e3a8a">${escape(info.tournament)}</p>
<p style="margin:0 0 12px;font-size:15px">${escape(intro)}</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:15px">${rows}</ul>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1e3a8a" style="border-radius:12px"><a href="${escape(info.joinUrl)}" style="display:inline-block;padding:14px 20px;mso-padding-alt:0;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px"><!--[if mso]><i style="mso-font-width:150%;mso-text-raise:21pt">&nbsp;</i><![endif]-->Inscrire mon équipe<!--[if mso]><i style="mso-font-width:150%">&nbsp;</i><![endif]--></a></td></tr></table>
<p style="margin:20px 0 0;font-size:12px;color:#5c6a7f">${escape(why)} <a href="${escape(info.unsubscribeUrl)}" style="color:#5c6a7f">Ne plus recevoir les nouvelles éditions de ce club</a>.</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
  return {
    to,
    subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${info.oneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/**
 * Partenaire de l'édition précédente : le même pack lui est proposé pour la
 * nouvelle édition, avec son lien de paiement personnel. Envoyé une seule
 * fois, à la publication de l'édition suivante ; désinscription en un clic.
 */
export function sponsorRenewalMail(
  to: string,
  info: {
    club: string;
    previous: string;
    tournament: string;
    sponsor: string;
    tier: keyof typeof TIER_NAME;
    /** Terrain gardé d'une année sur l'autre (« Terrain 1 »), ou null. */
    field: string | null;
    /** « lundi 8 novembre 2027 » */
    date: string;
    venue: string;
    totalCents: number;
    url: string;
    unsubscribeUrl: string;
    oneClickUrl: string;
  },
): MailMessage {
  const pack = packLabel(info.tier) + (info.field ? ` (${info.field})` : '');
  const amount = eurosLabel(info.totalCents);
  const subject = `${info.club} – ${info.tournament}\u202f: renouveler votre ${packLabel(info.tier)}\u202f?`;
  const intro = `Merci d’avoir soutenu « ${info.previous} ». ${info.club} organise la nouvelle édition et propose à ${info.sponsor} de renouveler son partenariat.`;
  const why = `Vous recevez cet email car ${info.sponsor} était partenaire de « ${info.previous} ». ${info.club} ne vous écrit qu’à la publication d’une nouvelle édition.`;
  const details = [
    `${pack}, comme l’an dernier`,
    `${info.date} · ${info.venue}`,
    `Montant\u202f: ${amount}, frais de service compris`,
  ];
  const text = [
    intro,
    '',
    ...details,
    '',
    `Renouveler et payer en ligne\u202f: ${info.url}`,
    '',
    'Le paiement est sécurisé par Stripe et versé au club. Ce lien vous est personnel ; sans réponse, rien ne vous est demandé.',
    '',
    why,
    `Ne plus être sollicité par ce club\u202f: ${info.unsubscribeUrl}`,
    '',
    'Tournoi Connect',
  ].join('\n');
  const rows = details
    .map((line) => `<li style="margin:0 0 6px">${escape(line)}</li>`)
    .join('');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:#f7f8fa;font-family:Inter,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f8fa"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="420" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:420px;background:#ffffff;border-radius:16px"><tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:15px">Nouvelle édition · ${escape(info.club)}</p>
<p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1e3a8a">${escape(info.tournament)}</p>
<p style="margin:0 0 12px;font-size:15px">${escape(intro)}</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:15px">${rows}</ul>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1e3a8a" style="border-radius:12px"><a href="${escape(info.url)}" style="display:inline-block;padding:14px 20px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">Renouveler et payer</a></td></tr></table>
<p style="margin:16px 0 0;font-size:13px;color:#5c6a7f">Paiement sécurisé par Stripe, versé au club. Sans réponse, rien ne vous est demandé.</p>
<p style="margin:16px 0 0;font-size:12px;color:#5c6a7f">${escape(why)} <a href="${escape(info.unsubscribeUrl)}" style="color:#5c6a7f">Ne plus être sollicité par ce club</a>.</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
  return {
    to,
    subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${info.oneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
