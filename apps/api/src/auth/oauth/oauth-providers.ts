import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  SignJWT,
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import type { Env } from '../../config/env.js';
import type { ExternalIdentity } from '../auth.service.js';

export type OAuthProvider = 'GOOGLE' | 'APPLE' | 'FACEBOOK';
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = [
  'GOOGLE',
  'APPLE',
  'FACEBOOK',
];

/** Paramètres de l'aller-retour, gardés dans le cookie signé. */
export interface OAuthFlow {
  provider: OAuthProvider;
  state: string;
  nonce: string;
  /** Vérificateur PKCE (le défi S256 part chez le fournisseur). */
  verifier: string;
  /** Écran de la PWA où revenir après la connexion. */
  returnTo: string;
}

export interface OAuthCallback {
  code: string;
  /** Apple : nom et prénom, envoyés une seule fois, à la première connexion. */
  user?: string;
}

const GRAPH = 'https://graph.facebook.com/v21.0';

export const randomToken = () => randomBytes(24).toString('base64url');
export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

/**
 * Google, Apple et Facebook : URL d'autorisation, échange du code et identité
 * vérifiée. Un fournisseur sans identifiants dans la configuration n'est pas
 * proposé.
 */
@Injectable()
export class OAuthProviders {
  private readonly jwks = new Map<string, JWTVerifyGetKey>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  enabled(): OAuthProvider[] {
    const c = (key: keyof Env) =>
      Boolean(this.config.get(key, { infer: true }));
    return OAUTH_PROVIDERS.filter((p) =>
      p === 'GOOGLE'
        ? c('GOOGLE_CLIENT_ID') && c('GOOGLE_CLIENT_SECRET')
        : p === 'APPLE'
          ? c('APPLE_CLIENT_ID') &&
            c('APPLE_TEAM_ID') &&
            c('APPLE_KEY_ID') &&
            c('APPLE_PRIVATE_KEY')
          : c('FACEBOOK_APP_ID') && c('FACEBOOK_APP_SECRET'),
    );
  }

  redirectUri(provider: OAuthProvider): string {
    const base = this.config
      .get('PUBLIC_APP_URL', { infer: true })
      .replace(/\/$/, '');
    return `${base}/api/v1/auth/oauth/${provider.toLowerCase()}/callback`;
  }

  authorizeUrl(flow: OAuthFlow): string {
    const redirect = this.redirectUri(flow.provider);
    const challenge = pkceChallenge(flow.verifier);
    switch (flow.provider) {
      case 'GOOGLE':
        return url('https://accounts.google.com/o/oauth2/v2/auth', {
          client_id: this.get('GOOGLE_CLIENT_ID'),
          redirect_uri: redirect,
          response_type: 'code',
          scope: 'openid email profile',
          state: flow.state,
          nonce: flow.nonce,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          prompt: 'select_account',
        });
      case 'APPLE':
        // form_post : Apple revient en POST, obligatoire pour obtenir nom et email.
        return url('https://appleid.apple.com/auth/authorize', {
          client_id: this.get('APPLE_CLIENT_ID'),
          redirect_uri: redirect,
          response_type: 'code',
          response_mode: 'form_post',
          scope: 'name email',
          state: flow.state,
          nonce: flow.nonce,
        });
      case 'FACEBOOK':
        return url('https://www.facebook.com/v21.0/dialog/oauth', {
          client_id: this.get('FACEBOOK_APP_ID'),
          redirect_uri: redirect,
          response_type: 'code',
          scope: 'email,public_profile',
          state: flow.state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        });
    }
  }

  /** Échange le code et renvoie l'identité, vérifiée auprès du fournisseur. */
  async identify(
    flow: OAuthFlow,
    callback: OAuthCallback,
  ): Promise<ExternalIdentity> {
    switch (flow.provider) {
      case 'GOOGLE':
        return this.google(flow, callback);
      case 'APPLE':
        return this.apple(flow, callback);
      case 'FACEBOOK':
        return this.facebook(flow, callback);
    }
  }

  private async google(
    flow: OAuthFlow,
    callback: OAuthCallback,
  ): Promise<ExternalIdentity> {
    const tokens = await postForm('https://oauth2.googleapis.com/token', {
      code: callback.code,
      client_id: this.get('GOOGLE_CLIENT_ID'),
      client_secret: this.get('GOOGLE_CLIENT_SECRET'),
      redirect_uri: this.redirectUri('GOOGLE'),
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    });
    const claims = await this.verifyIdToken(tokens['id_token'], {
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: this.get('GOOGLE_CLIENT_ID'),
      nonce: flow.nonce,
    });
    if (
      claims['email_verified'] !== true ||
      typeof claims['email'] !== 'string'
    ) {
      throw new UnauthorizedException('Adresse Google non vérifiée.');
    }
    return {
      provider: 'GOOGLE',
      subject: String(claims.sub),
      email: claims['email'],
      ...names(claims['given_name'], claims['family_name']),
    };
  }

  private async apple(
    flow: OAuthFlow,
    callback: OAuthCallback,
  ): Promise<ExternalIdentity> {
    const tokens = await postForm('https://appleid.apple.com/auth/token', {
      client_id: this.get('APPLE_CLIENT_ID'),
      client_secret: await this.appleClientSecret(),
      code: callback.code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri('APPLE'),
    });
    const claims = await this.verifyIdToken(tokens['id_token'], {
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
      audience: this.get('APPLE_CLIENT_ID'),
      nonce: flow.nonce,
    });
    const verified =
      claims['email_verified'] === true || claims['email_verified'] === 'true';
    if (!verified || typeof claims['email'] !== 'string') {
      throw new UnauthorizedException('Adresse Apple non vérifiée.');
    }
    let first: unknown;
    let last: unknown;
    try {
      const user = JSON.parse(callback.user ?? '{}') as {
        name?: { firstName?: string; lastName?: string };
      };
      first = user.name?.firstName;
      last = user.name?.lastName;
    } catch {
      // Nom absent ou illisible : la PWA le demandera.
    }
    return {
      provider: 'APPLE',
      subject: String(claims.sub),
      email: claims['email'],
      ...names(first, last),
    };
  }

  private async facebook(
    flow: OAuthFlow,
    callback: OAuthCallback,
  ): Promise<ExternalIdentity> {
    const tokens = await getJson(
      url(`${GRAPH}/oauth/access_token`, {
        client_id: this.get('FACEBOOK_APP_ID'),
        client_secret: this.get('FACEBOOK_APP_SECRET'),
        redirect_uri: this.redirectUri('FACEBOOK'),
        code: callback.code,
        code_verifier: flow.verifier,
      }),
    );
    const accessToken =
      typeof tokens['access_token'] === 'string' ? tokens['access_token'] : '';
    const proof = createHmac('sha256', this.get('FACEBOOK_APP_SECRET'))
      .update(accessToken)
      .digest('hex');
    const me = await getJson(
      url(`${GRAPH}/me`, {
        fields: 'id,email,first_name,last_name',
        access_token: accessToken,
        appsecret_proof: proof,
      }),
    );
    if (typeof me['email'] !== 'string' || typeof me['id'] !== 'string') {
      throw new UnauthorizedException(
        'Facebook n’a pas transmis d’adresse email.',
      );
    }
    return {
      provider: 'FACEBOOK',
      subject: me['id'],
      email: me['email'],
      ...names(me['first_name'], me['last_name']),
    };
  }

  private async verifyIdToken(
    token: unknown,
    options: {
      jwksUrl: string;
      issuer: string | string[];
      audience: string;
      nonce: string;
    },
  ): Promise<Record<string, unknown> & { sub?: string }> {
    if (typeof token !== 'string') {
      throw new UnauthorizedException('Réponse du fournisseur incomplète.');
    }
    let keys = this.jwks.get(options.jwksUrl);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(options.jwksUrl));
      this.jwks.set(options.jwksUrl, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: options.issuer,
      audience: options.audience,
    });
    if (payload['nonce'] !== options.nonce || !payload.sub) {
      throw new UnauthorizedException('Jeton du fournisseur invalide.');
    }
    return payload;
  }

  /** Secret client d'Apple : un JWT ES256 signé avec la clé « Sign in with Apple ». */
  private async appleClientSecret(): Promise<string> {
    const key = await importPKCS8(
      this.get('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      'ES256',
    );
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.get('APPLE_KEY_ID') })
      .setIssuer(this.get('APPLE_TEAM_ID'))
      .setSubject(this.get('APPLE_CLIENT_ID'))
      .setAudience('https://appleid.apple.com')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(key);
  }

  private get(key: keyof Env): string {
    const value = this.config.get(key, { infer: true });
    if (typeof value !== 'string' || !value) {
      throw new UnauthorizedException(
        'Fournisseur de connexion non configuré.',
      );
    }
    return value;
  }
}

function url(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params).toString()}`;
}

function names(
  first: unknown,
  last: unknown,
): { firstName?: string; lastName?: string } {
  return {
    ...(typeof first === 'string' && first.trim()
      ? { firstName: first.trim().slice(0, 60) }
      : {}),
    ...(typeof last === 'string' && last.trim()
      ? { lastName: last.trim().slice(0, 60) }
      : {}),
  };
}

async function postForm(
  endpoint: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new UnauthorizedException('Le fournisseur a refusé la connexion.');
  }
  return (await response.json()) as Record<string, unknown>;
}

async function getJson(endpoint: string): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new UnauthorizedException('Le fournisseur a refusé la connexion.');
  }
  return (await response.json()) as Record<string, unknown>;
}
