import type { MailMessage } from './mail-sender.js';

/** Logo servi par l'application (public/brand) : 176 × 190 px, affiché à moitié. */
export const EMAIL_LOGO_PATH = '/brand/logo-email.png';

/**
 * Ajoute le logo Tournoi Connect en tête de la version HTML de l'email.
 * Tableau centré (lu par Outlook) ; images bloquées : le texte alternatif reste.
 */
export function withBrand(message: MailMessage, appUrl: string): MailMessage {
  const src = `${appUrl.replace(/\/$/, '')}${EMAIL_LOGO_PATH}`;
  const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:16px 0">
<img src="${src}" width="88" height="95" alt="Tournoi Connect" style="display:block;border:0;border-radius:12px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#062541">
</td></tr></table>`;
  let added = false;
  const html = message.html.replace(/<body[^>]*>/, (body) => {
    added = true;
    return `${body}\n${header}`;
  });
  return added ? { ...message, html } : message;
}
