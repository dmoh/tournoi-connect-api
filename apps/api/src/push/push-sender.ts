import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import {
  encryptPayload,
  vapidAuthorization,
  type PushKeys,
} from './web-push.js';

export interface PushTarget extends PushKeys {
  endpoint: string;
}

/** Résultat d'un envoi : livré, abonnement expiré (à supprimer), ou échec passager. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Envoi HTTP vers le service push du navigateur (Web Push, RFC 8030). */
@Injectable()
export class PushSender {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  get publicKey(): string | null {
    return this.keys()?.publicKey ?? null;
  }

  async send(target: PushTarget, payload: object): Promise<PushOutcome> {
    const keys = this.keys();
    if (!keys) {
      return 'failed';
    }
    try {
      const body = encryptPayload(Buffer.from(JSON.stringify(payload)), target);
      const response = await fetch(target.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidAuthorization(
            target.endpoint,
            keys,
            this.clock.now(),
          ),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          // Un but n'a plus d'intérêt au bout d'une heure.
          TTL: '3600',
          Urgency: 'high',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404 || response.status === 410) {
        return 'gone';
      }
      if (!response.ok) {
        this.logger.warn(
          `Service push ${new URL(target.endpoint).host} : ${response.status}`,
        );
        return 'failed';
      }
      return 'sent';
    } catch (error) {
      this.logger.warn(`Envoi push impossible : ${(error as Error).message}`);
      return 'failed';
    }
  }

  private keys() {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY', { infer: true });
    const privateKey = this.config.get('VAPID_PRIVATE_KEY', { infer: true });
    return publicKey && privateKey
      ? {
          publicKey,
          privateKey,
          subject: this.config.get('PUBLIC_APP_URL', { infer: true }),
        }
      : null;
  }
}
