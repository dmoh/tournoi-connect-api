import { S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { S3MediaStorage, sniffPhotoType } from './media-storage.js';

/** Identifiants tirés au hasard : rien n'est envoyé, la signature est seulement calculée. */
const client = new S3Client({
  region: 'eu-west-3',
  credentials: {
    accessKeyId: `AKIA${randomBytes(8).toString('hex').toUpperCase()}`,
    secretAccessKey: randomBytes(30).toString('base64'),
  },
});

describe('S3MediaStorage', () => {
  const storage = new S3MediaStorage(
    client,
    'tc-preprod-media',
    'https://media.example.org/',
  );

  it('signe un envoi limité au type et à la taille exacte, pour 10 minutes', async () => {
    const now = new Date('2026-11-14T10:00:00Z');
    const signed = await storage.signUpload(
      'photos/t1/p1.jpg',
      'image/jpeg',
      182_044,
      now,
    );
    const url = new URL(signed.url);
    expect(url.host).toBe('tc-preprod-media.s3.eu-west-3.amazonaws.com');
    expect(url.pathname).toBe('/photos/t1/p1.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261114T100000Z');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host',
    );
    expect(signed.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(signed.expiresAt.toISOString()).toBe('2026-11-14T10:10:00.000Z');
  });

  it('sert la photo par l’adresse CloudFront', () => {
    expect(storage.publicUrl('photos/t1/p1.jpg')).toBe(
      'https://media.example.org/photos/t1/p1.jpg',
    );
  });
});

describe('sniffPhotoType', () => {
  const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

  it('reconnaît JPEG et WebP à leurs premiers octets', () => {
    expect(sniffPhotoType(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]))).toBe(
      'image/jpeg',
    );
    expect(sniffPhotoType(bytes('RIFF\x10\x00\x00\x00WEBPVP8 '))).toBe(
      'image/webp',
    );
  });

  it('refuse le reste (PNG, HTML, SVG)', () => {
    expect(
      sniffPhotoType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])),
    ).toBeNull();
    expect(sniffPhotoType(bytes('<html><body>'))).toBeNull();
    expect(sniffPhotoType(bytes('<svg xmlns='))).toBeNull();
    expect(sniffPhotoType(new Uint8Array())).toBeNull();
  });
});
