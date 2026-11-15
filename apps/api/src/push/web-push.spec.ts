import { createDecipheriv, createECDH, createHmac } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import {
  encryptPayload,
  generateVapidKeys,
  VapidCache,
  vapidAuthorization,
} from './web-push.js';

const fromB64 = (text: string) => Buffer.from(text, 'base64url');
const hmac = (key: Buffer, data: Buffer) =>
  createHmac('sha256', key).update(data).digest();

/** Déchiffrement côté navigateur (RFC 8291), pour vérifier l'aller-retour. */
function decrypt(
  body: Buffer,
  uaPrivate: Buffer,
  uaPublic: Buffer,
  auth: Buffer,
): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(uaPrivate);
  const shared = ua.computeSecret(asPublic);
  const prkKey = hmac(auth, shared);
  const ikm = hmac(
    prkKey,
    Buffer.concat([
      Buffer.from('WebPush: info\0'),
      uaPublic,
      asPublic,
      Buffer.from([1]),
    ]),
  );
  const prk = hmac(salt, ikm);
  const cek = hmac(
    prk,
    Buffer.from('Content-Encoding: aes128gcm\0\x01'),
  ).subarray(0, 16);
  const nonce = hmac(
    prk,
    Buffer.from('Content-Encoding: nonce\0\x01'),
  ).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, -16)),
    decipher.final(),
  ]);
  expect(plain.at(-1)).toBe(2);
  return plain.subarray(0, -1).toString('utf8');
}

describe('Web Push', () => {
  it('reproduit le vecteur de test de la RFC 8291 (annexe A)', () => {
    const as = createECDH('prime256v1');
    as.setPrivateKey(fromB64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
    const body = encryptPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        // Valeur publique du vecteur de test de la RFC 8291 (annexe A), pas un secret.
        auth: 'BTBZMqHH6r4Tts7J_aSIgg', // gitleaks:allow
      },
      as,
      fromB64('DGv6ra1nlYgDCS1FRnbzlw'),
    );
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('chiffre un message que le navigateur déchiffre', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.from('0123456789abcdef');
    const body = encryptPayload(
      Buffer.from('{"notification":{"title":"But !"}}'),
      {
        p256dh: ua.getPublicKey().toString('base64url'),
        auth: auth.toString('base64url'),
      },
    );
    expect(decrypt(body, ua.getPrivateKey(), ua.getPublicKey(), auth)).toBe(
      '{"notification":{"title":"But !"}}',
    );
  });

  it('signe l’en-tête VAPID pour l’origine du service push', async () => {
    const keys = {
      ...generateVapidKeys(),
      subject: 'https://app.tournoi-connect.com',
    };
    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      new Date('2026-11-11T10:00:00Z'),
    );
    const [, jwt] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(decodeProtectedHeader(jwt!)).toMatchObject({ alg: 'ES256' });
    expect(decodeJwt(jwt!)).toMatchObject({
      aud: 'https://fcm.googleapis.com',
      sub: 'https://app.tournoi-connect.com',
      exp: Math.floor(Date.parse('2026-11-11T22:00:00Z') / 1000),
    });
    expect(header.endsWith(keys.publicKey)).toBe(true);
  });

  describe('cache des en-têtes VAPID', () => {
    const keys = {
      ...generateVapidKeys(),
      subject: 'https://app.tournoi-connect.com',
    };
    const at = (iso: string) => new Date(iso);

    it('signe une seule fois pour N envois vers la même origine', async () => {
      const sign = vi.fn(vapidAuthorization);
      const cache = new VapidCache(sign);
      const headers = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          cache.authorization(
            `https://fcm.googleapis.com/fcm/send/abonne-${i}`,
            keys,
            at('2026-11-11T10:00:00Z'),
          ),
        ),
      );
      expect(sign).toHaveBeenCalledTimes(1);
      expect(new Set(headers).size).toBe(1);
      const [, jwt] = /^vapid t=([^,]+), k=/.exec(headers[0]!)!;
      expect(decodeJwt(jwt!).aud).toBe('https://fcm.googleapis.com');
    });

    it('signe à part chaque origine et renouvelle au bout de 11 heures', async () => {
      const sign = vi.fn(vapidAuthorization);
      const cache = new VapidCache(sign);
      const fcm = 'https://fcm.googleapis.com/fcm/send/a';
      const mozilla = 'https://updates.push.services.mozilla.com/wpush/v2/b';
      await cache.authorization(fcm, keys, at('2026-11-11T10:00:00Z'));
      await cache.authorization(mozilla, keys, at('2026-11-11T10:00:00Z'));
      await cache.authorization(fcm, keys, at('2026-11-11T20:59:59Z'));
      expect(sign).toHaveBeenCalledTimes(2);
      await cache.authorization(fcm, keys, at('2026-11-11T21:00:00Z'));
      expect(sign).toHaveBeenCalledTimes(3);
      // Horloge revenue en arrière : on ne réutilise pas un JWT émis « plus tard ».
      await cache.authorization(fcm, keys, at('2026-11-11T09:00:00Z'));
      expect(sign).toHaveBeenCalledTimes(4);
    });

    it('ne garde pas une signature ratée', async () => {
      const sign = vi
        .fn(vapidAuthorization)
        .mockRejectedValueOnce(new Error('clé illisible'));
      const cache = new VapidCache(sign);
      const fcm = 'https://fcm.googleapis.com/fcm/send/a';
      await expect(
        cache.authorization(fcm, keys, at('2026-11-11T10:00:00Z')),
      ).rejects.toThrow('clé illisible');
      await expect(
        cache.authorization(fcm, keys, at('2026-11-11T10:00:01Z')),
      ).resolves.toMatch(/^vapid t=/);
      expect(sign).toHaveBeenCalledTimes(2);
    });
  });
});
