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
