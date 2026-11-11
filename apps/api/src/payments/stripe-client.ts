import { Logger } from '@nestjs/common';

const API = 'https://api.stripe.com/v1';

/** Devise des paiements d'inscription (minuscules, comme Stripe la renvoie). */
export const CURRENCY = 'eur';

/** Erreur renvoyée par Stripe (message lisible et code). */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface CheckoutSessionInput {
  /** Compte Connect du club, qui reçoit le paiement. */
  destination: string;
  /** Commission de la plateforme (frais de service). */
  applicationFeeCents: number;
  lines: { name: string; amountCents: number }[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Fin de la session (30 min au moins pour Stripe). */
  expiresAt: Date;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface RefundInput {
  /** Paiement de la session Checkout (charge de destination). */
  paymentIntent: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

/** Corps form-urlencoded de Stripe : objets et tableaux en clés imbriquées (a[b][0]=…). */
export function formEncode(value: unknown, prefix = ''): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => formEncode(v, `${prefix}[${i}]`));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      formEncode(v, prefix ? `${prefix}[${k}]` : k),
    );
  }
  return [
    `${encodeURIComponent(prefix)}=${encodeURIComponent(String(value as string))}`,
  ];
}

/**
 * Client Stripe minimal (API REST, sans SDK) : comptes Connect Express du
 * club, lien d'activation, sessions Checkout en charge de destination,
 * remboursements.
 */
export class StripeClient {
  private readonly logger = new Logger('Stripe');

  constructor(private readonly secretKey: string | null) {}

  get enabled(): boolean {
    return this.secretKey !== null;
  }

  /** Clé du mode réel (sk_live_, rk_live_) : les événements doivent avoir le même livemode. */
  get livemode(): boolean {
    return /^[rs]k_live_/.test(this.secretKey ?? '');
  }

  createAccount(input: { email: string; clubName: string; clubSlug: string }) {
    return this.post<{ id: string }>('/accounts', {
      type: 'express',
      country: 'FR',
      email: input.email,
      business_profile: { name: input.clubName },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { organization: input.clubSlug },
    });
  }

  accountLink(account: string, refreshUrl: string, returnUrl: string) {
    return this.post<{ url: string }>('/account_links', {
      account,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  }

  retrieveAccount(id: string) {
    return this.request<{
      id: string;
      charges_enabled: boolean;
      details_submitted: boolean;
    }>('GET', `/accounts/${encodeURIComponent(id)}`);
  }

  createCheckoutSession(input: CheckoutSessionInput) {
    return this.post<{ id: string; url: string }>(
      '/checkout/sessions',
      {
        mode: 'payment',
        customer_email: input.customerEmail,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        locale: 'fr',
        line_items: input.lines.map((line) => ({
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: line.amountCents,
            product_data: { name: line.name },
          },
        })),
        payment_intent_data: {
          application_fee_amount: input.applicationFeeCents,
          transfer_data: { destination: input.destination },
          metadata: input.metadata,
        },
        metadata: input.metadata,
      },
      input.idempotencyKey,
    );
  }

  /**
   * Remboursement intégral d'une charge de destination : le virement au club
   * est repris (reverse_transfer) et la commission de la plateforme lui est
   * rendue (refund_application_fee), le club et la plateforme reviennent à zéro.
   */
  createRefund(input: RefundInput) {
    return this.post<{ id: string; status: string }>(
      '/refunds',
      {
        payment_intent: input.paymentIntent,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: input.metadata,
      },
      input.idempotencyKey,
    );
  }

  private post<T>(
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    return this.request<T>('POST', path, body, idempotencyKey);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    if (!this.secretKey) {
      throw new StripeError('Paiements non configurés.', 503);
    }
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body ? { body: formEncode(body).join('&') } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json()) as T & {
      error?: { message?: string; code?: string };
    };
    if (!response.ok) {
      const message = json.error?.message ?? `Stripe ${response.status}`;
      this.logger.warn(`${method} ${path} : ${message}`);
      throw new StripeError(message, response.status, json.error?.code);
    }
    return json;
  }
}
