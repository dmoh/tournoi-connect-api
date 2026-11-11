/**
 * Services push des navigateurs acceptés comme destinataires (Web Push,
 * RFC 8030). Toute autre adresse est refusée à l'abonnement et ignorée à
 * l'envoi : le serveur ne poste jamais vers un hôte choisi par le client.
 */
const EXACT_HOSTS = new Set([
  // Chrome, Edge Android, Opera, Samsung Internet, Brave (Firebase Cloud Messaging).
  'fcm.googleapis.com',
  // Firefox (autopush).
  'updates.push.services.mozilla.com',
  // Safari (macOS 13+, iOS 16.4+).
  'web.push.apple.com',
]);

/** Suffixes documentés par les éditeurs (sous-domaines régionaux). */
const HOST_SUFFIXES = [
  '.push.services.mozilla.com',
  // Edge Windows (Windows Push Notification Services).
  '.notify.windows.com',
  // Apple demande d'autoriser *.push.apple.com.
  '.push.apple.com',
];

/** Vrai si `endpoint` est une adresse https d'un service push connu. */
export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return false;
  }
  const host = url.hostname;
  return (
    EXACT_HOSTS.has(host) ||
    HOST_SUFFIXES.some(
      (suffix) => host.endsWith(suffix) && host.length > suffix.length,
    )
  );
}
