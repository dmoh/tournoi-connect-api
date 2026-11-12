import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AuthUser } from '../../auth/auth.guard.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { Clock } from '../clock.js';
import { isUniqueViolation } from '../prisma-errors.js';

/** En-tête lu (Fastify met les noms d'en-têtes en minuscules). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Format accepté : celui des inscriptions ; un UUID v4 de la PWA y entre. */
export const IDEMPOTENCY_KEY_PATTERN = /^[\w-]{8,100}$/;

/** Durée pendant laquelle une clé rejoue sa réponse ; la purge passe ensuite. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** En-tête posé sur une réponse rejouée. */
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

interface IdempotentRequest extends FastifyRequest {
  user?: AuthUser;
  organizationSlug?: string;
}

/** JSON aux clés triées : deux corps égaux ont la même empreinte. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function fingerprint(body: unknown): string {
  return createHash('sha256')
    .update(canonical(body ?? null))
    .digest('hex');
}

type Claim =
  { kind: 'run'; id: string } | { kind: 'replay'; response: unknown };

/**
 * Idempotency-Key sur une écriture connectée (posé par `@Idempotent()`).
 *
 * - Sans en-tête : la requête passe telle quelle.
 * - Première requête : une ligne « en cours » est insérée, la route
 *   s'exécute, puis sa réponse est enregistrée. Une erreur efface la ligne :
 *   la même clé pourra être renvoyée.
 * - Même clé, même corps : la réponse enregistrée est rejouée (24 heures).
 * - Même clé, autre corps : 422.
 * - Même clé encore en cours : 409. L'exclusivité vient de la contrainte
 *   unique (compte, portée, clé) en base, pas d'un verrou en mémoire : elle
 *   tient entre plusieurs instances de l'API.
 *
 * La portée est le compte, le club (X-Organization), la méthode et le chemin.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<IdempotentRequest>();
    const header = request.headers[IDEMPOTENCY_HEADER];
    if (header === undefined) {
      return next.handle();
    }
    if (typeof header !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(header)) {
      throw new BadRequestException('En-tête Idempotency-Key invalide.');
    }
    if (!request.user) {
      throw new Error('@Idempotent() exige une route connectée.');
    }
    const status =
      this.reflector.get<number | undefined>(
        HTTP_CODE_METADATA,
        context.getHandler(),
      ) ?? (request.method === 'POST' ? 201 : 200);
    const reply = http.getResponse<FastifyReply>();
    const where = {
      userId: request.user.id,
      scope: [
        request.organizationSlug ?? '-',
        request.method,
        request.url.split('?')[0],
      ].join(' '),
      key: header,
    };
    return from(
      this.run(where, fingerprint(request.body), status, reply, next),
    );
  }

  private async run(
    where: { userId: string; scope: string; key: string },
    print: string,
    status: number,
    reply: FastifyReply,
    next: CallHandler,
  ): Promise<unknown> {
    const claim = await this.claim(where, print);
    if (claim.kind === 'replay') {
      void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
      return claim.response;
    }
    let response: unknown;
    try {
      response = await lastValueFrom(next.handle(), {
        defaultValue: undefined,
      });
    } catch (error) {
      await this.prisma.idempotencyKey.deleteMany({ where: { id: claim.id } });
      throw error;
    }
    // L'écriture a eu lieu : un échec d'enregistrement ne la change pas en
    // erreur. La clé reste « en cours » (409) jusqu'à la purge, jamais rejouée
    // à neuf.
    await this.prisma.idempotencyKey
      .update({
        where: { id: claim.id },
        data: {
          status,
          response:
            response === undefined
              ? Prisma.DbNull
              : (response as Prisma.InputJsonValue),
        },
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Réponse de la clé ${claim.id} non enregistrée : ${String(error)}`,
        ),
      );
    return response;
  }

  /** Réserve la clé, ou dit quoi faire de la requête qui la tient déjà. */
  private async claim(
    where: { userId: string; scope: string; key: string },
    print: string,
  ): Promise<Claim> {
    const now = this.clock.now();
    // Deux passes : une clé expirée non purgée, ou libérée par l'échec de la
    // requête qui la tenait, se reprend une fois.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const row = await this.prisma.idempotencyKey.create({
          data: { ...where, fingerprint: print, createdAt: now },
          select: { id: true },
        });
        return { kind: 'run', id: row.id };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { userId_scope_key: where },
      });
      if (!existing) {
        continue;
      }
      if (existing.createdAt.getTime() <= now.getTime() - IDEMPOTENCY_TTL_MS) {
        await this.prisma.idempotencyKey.deleteMany({
          where: { id: existing.id, createdAt: existing.createdAt },
        });
        continue;
      }
      if (existing.fingerprint !== print) {
        throw new UnprocessableEntityException(
          'Cette clé Idempotency-Key a servi pour une autre requête.',
        );
      }
      if (existing.status === null) {
        throw new ConflictException(
          'Une requête avec cette clé Idempotency-Key est en cours de traitement.',
        );
      }
      return { kind: 'replay', response: existing.response ?? undefined };
    }
    throw new ConflictException(
      'Une requête avec cette clé Idempotency-Key est en cours de traitement.',
    );
  }
}
