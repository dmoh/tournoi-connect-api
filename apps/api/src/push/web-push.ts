import {
  createCipheriv,
  createECDH,
  createHmac,
  randomBytes,
  type ECDH,
} from 'node:crypto';
import { SignJWT, importJWK } from 'jose';

const b64 = (data: Buffer | Uint8Array) =>
  Buffer.from(data).toString('base64url');
const fromB64 = (text: string) => Buffer.from(text, 'base64url');
const hmac = (key: Buffer, data: Buffer) =>
  createHmac('sha256', key).update(data).digest();

/** Clé éphémère du serveur, neuve à chaque message. */
function freshKeys(): ECDH {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh;
}

/** Taille d'enregistrement annoncée (un seul enregistrement par message). */
const RECORD_SIZE = 4096;

export interface PushKeys {
  /** Clé publique ECDH P-256 du navigateur (base64url, 65 octets). */
  p256dh: string;
  /** Secret d'authentification du navigateur (base64url, 16 octets). */
  auth: string;
}

/**
 * Chiffre le message pour le navigateur (RFC 8291, « aes128gcm ») : clé
 * éphémère du serveur, secret partagé ECDH, clés dérivées par HKDF-SHA-256.
 * `ephemeral` et `salt` ne servent qu'aux vecteurs de test.
 */
export function encryptPayload(
  payload: Buffer,
  keys: PushKeys,
  ephemeral: ECDH = freshKeys(),
  salt: Buffer = randomBytes(16),
): Buffer {
  const uaPublic = fromB64(keys.p256dh);
  const asPublic = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(uaPublic);
  // IKM = HKDF(auth, ecdh, "WebPush: info" || 0 || ua_public || as_public, 32)
  const prkKey = hmac(fromB64(keys.auth), shared);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
    Buffer.from([1]),
  ]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(
    prk,
    Buffer.from('Content-Encoding: aes128gcm\0\x01'),
  ).subarray(0, 16);
  const nonce = hmac(
    prk,
    Buffer.from('Content-Encoding: nonce\0\x01'),
  ).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // Délimiteur 0x02 : dernier (et seul) enregistrement.
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, encrypted]);
}

/** Paire de clés VAPID (base64url : publique 65 octets, privée 32 octets). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64(ecdh.getPublicKey()),
    privateKey: b64(ecdh.getPrivateKey()),
  };
}

/**
 * En-tête Authorization VAPID (RFC 8292) pour le service push de `endpoint` :
 * JWT ES256 valable 12 heures, signé par la clé privée de la plateforme.
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: { publicKey: string; privateKey: string; subject: string },
  now: Date,
): Promise<string> {
  const publicKey = fromB64(keys.publicKey);
  const key = await importJWK(
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64(publicKey.subarray(1, 33)),
      y: b64(publicKey.subarray(33, 65)),
      d: keys.privateKey,
    },
    'ES256',
  );
  const issuedAt = Math.floor(now.getTime() / 1000);
  const jwt = await new SignJWT({ sub: keys.subject })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime(issuedAt + 12 * 60 * 60)
    .sign(key);
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

type VapidKeys = Parameters<typeof vapidAuthorization>[1];

/** Le JWT dure 12 heures : on le renouvelle au bout de 11 heures. */
const VAPID_REUSE_MS = 11 * 60 * 60 * 1000;

/**
 * En-têtes VAPID gardés en mémoire par service push : le JWT ne dépend que
 * de l'origine du service (son audience), une signature ES256 sert donc à
 * tous les envois vers cette origine pendant 11 heures. Les envois
 * simultanés d'une même origine partagent la même signature en cours.
 */
export class VapidCache {
  private readonly entries = new Map<
    string,
    { header: Promise<string>; issuedAt: number }
  >();

  constructor(private readonly sign = vapidAuthorization) {}

  authorization(endpoint: string, keys: VapidKeys, now: Date): Promise<string> {
    const origin = new URL(endpoint).origin;
    const key = `${keys.publicKey} ${keys.subject} ${origin}`;
    const at = now.getTime();
    const cached = this.entries.get(key);
    if (
      cached &&
      at >= cached.issuedAt &&
      at < cached.issuedAt + VAPID_REUSE_MS
    ) {
      return cached.header;
    }
    this.prune(at);
    const header = this.sign(endpoint, keys, now);
    this.entries.set(key, { header, issuedAt: at });
    // Une signature ratée n'est pas gardée : le prochain envoi réessaie.
    header.catch(() => {
      if (this.entries.get(key)?.header === header) {
        this.entries.delete(key);
      }
    });
    return header;
  }

  /** Oublie les en-têtes périmés (sous-domaines régionaux en nombre limité). */
  private prune(at: number): void {
    for (const [key, entry] of this.entries) {
      if (at < entry.issuedAt || at >= entry.issuedAt + VAPID_REUSE_MS) {
        this.entries.delete(key);
      }
    }
  }
}
