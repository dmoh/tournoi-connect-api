import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/** Corps d'erreur RFC 9457, lu par l'intercepteur problem+json de la PWA. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: string[];
}

/**
 * Toute erreur sort en application/problem+json. Une erreur inattendue donne
 * un 500 générique, sans détail interne (le détail part dans les journaux).
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
