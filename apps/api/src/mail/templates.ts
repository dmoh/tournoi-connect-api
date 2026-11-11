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
