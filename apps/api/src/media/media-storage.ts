import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Durée de validité d'une URL d'envoi. */
export const UPLOAD_URL_TTL_S = 600;

/** Envoi direct vers le stockage : URL signée et en-têtes à reprendre tels quels. */
export interface SignedUpload {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/** Ce que le stockage sait d'un objet envoyé : taille, type déclaré, premiers octets. */
export interface StoredObject {
  bytes: number;
  contentType: string;
  /** Les 16 premiers octets, pour reconnaître le format réel. */
  head: Uint8Array;
}

/** Stockage des photos (remplacé par un faux dans les tests). */
export abstract class MediaStorage {
  /** Faux sans bucket ni adresse de diffusion : l'envoi est fermé. */
  abstract readonly enabled: boolean;
  abstract signUpload(
    key: string,
    contentType: string,
    bytes: number,
    now: Date,
  ): Promise<SignedUpload>;
  /** null si l'objet n'existe pas (envoi jamais fait). */
  abstract inspect(key: string): Promise<StoredObject | null>;
  abstract remove(keys: readonly string[]): Promise<void>;
  abstract publicUrl(key: string): string;
}

/** Jeton d'injection du stockage des photos. */
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/**
 * Bucket S3 privé, servi par CloudFront. L'URL signée fixe le type et la
 * taille exacte du fichier : S3 refuse tout autre envoi. Le rôle IAM du
 * serveur fournit les droits (aucune clé dans la configuration).
 */
export class S3MediaStorage extends MediaStorage {
  readonly enabled = true;
  private readonly baseUrl: string;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    publicUrl: string,
  ) {
    super();
    this.baseUrl = publicUrl.replace(/\/$/, '');
  }

  static create(
    region: string,
    bucket: string,
    publicUrl: string,
  ): S3MediaStorage {
    return new S3MediaStorage(new S3Client({ region }), bucket, publicUrl);
  }

  async signUpload(
    key: string,
    contentType: string,
    bytes: number,
    now: Date,
  ): Promise<SignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: bytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_URL_TTL_S,
      signingDate: now,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_S * 1000),
    };
  }

  async inspect(key: string): Promise<StoredObject | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: 'bytes=0-15',
        }),
      );
      const head = object.Body
        ? await object.Body.transformToByteArray()
        : new Uint8Array();
      // « bytes 0-15/123456 » : la taille totale suit la barre oblique.
      const total = Number(object.ContentRange?.split('/')[1]);
      return {
        bytes: Number.isFinite(total) ? total : (object.ContentLength ?? 0),
        contentType: object.ContentType ?? '',
        head,
      };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  async remove(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}

/** Sans configuration : aucune photo ne peut être envoyée. */
export class DisabledMediaStorage extends MediaStorage {
  readonly enabled = false;

  signUpload(): Promise<SignedUpload> {
    return Promise.reject(new Error('Stockage des photos non configuré.'));
  }

  inspect(): Promise<StoredObject | null> {
    return Promise.resolve(null);
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }

  publicUrl(key: string): string {
    return `/${key}`;
  }
}

/** Formats acceptés, reconnus à leurs premiers octets (pas au type déclaré). */
export const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export type PhotoContentType = keyof typeof PHOTO_TYPES;

export function sniffPhotoType(head: Uint8Array): PhotoContentType | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...head.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
