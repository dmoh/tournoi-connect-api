import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isPrismaError } from './prisma-errors.js';

/** Corps d'erreur RFC 9457, lu par l'intercepteur problem+json de la PWA. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: string[];
}

/**
 * Erreurs Prisma traduites en réponse HTTP : une violation d'unicité est un
 * conflit, un enregistrement absent (`…OrThrow`, `update`) une ressource
 * introuvable. Les autres codes restent des erreurs internes.
 */
const PRISMA_PROBLEMS: Record<string, Omit<ProblemDetails, 'type'>> = {
  P2002: {
    title: 'Conflict',
    status: HttpStatus.CONFLICT,
    detail: 'Cette ressource existe déjà.',
  },
  P2025: {
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail: 'Ressource introuvable.',
  },
};

/**
 * Toute erreur sort en application/problem+json. Une erreur inattendue donne
 * un 500 générique, sans détail interne (le détail part dans les journaux) ;
 * une erreur Prisma connue ne dit que son statut, jamais la table, la
 * contrainte ou la requête en cause.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const problem = this.toProblem(exception);
    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const body =
        typeof response === 'object' && response !== null
          ? (response as Record<string, unknown>)
          : {};
      const message = body['message'];
      const errors = Array.isArray(message) ? message.map(String) : undefined;
      return {
        type: 'about:blank',
        title:
          typeof body['error'] === 'string' ? body['error'] : exception.message,
        status,
        detail:
          typeof message === 'string'
            ? message
            : errors
              ? 'Requête invalide.'
              : undefined,
        ...(errors ? { errors } : {}),
      };
    }
    if (isPrismaError(exception) && exception.code in PRISMA_PROBLEMS) {
      const known = PRISMA_PROBLEMS[exception.code]!;
      this.logger.warn(`Erreur Prisma ${exception.code} : ${known.status}`);
      return { type: 'about:blank', ...known };
    }
    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      type: 'about:blank',
      title: 'Erreur interne',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
