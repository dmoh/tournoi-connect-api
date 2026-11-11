import { ConflictException, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the (index: \`tournament_slug_key\`)`,
    { code, clientVersion: '7.10.1', meta },
  );
}

function respond(exception: unknown) {
  const reply = {
    status: vi.fn(),
    header: vi.fn(),
    send: vi.fn(),
  };
  reply.status.mockReturnValue(reply);
  reply.header.mockReturnValue(reply);
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;
  new ProblemDetailsFilter().catch(exception, host);
  return {
    status: reply.status.mock.calls[0]?.[0] as number,
    contentType: reply.header.mock.calls[0]?.[1] as string,
    body: reply.send.mock.calls[0]?.[0] as Record<string, unknown>,
  };
}

describe('ProblemDetailsFilter', () => {
  it('traduit une violation d’unicité Prisma (P2002) en 409, sans détail interne', () => {
    const res = respond(
      prismaError('P2002', {
        modelName: 'Tournament',
        driverAdapterError: {
          cause: {
            kind: 'UniqueConstraintViolation',
            constraint: { index: 'tournament_slug_key' },
          },
        },
      }),
    );
    expect(res.status).toBe(409);
    expect(res.contentType).toBe('application/problem+json');
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Cette ressource existe déjà.',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/slug|tournament|Unique/i);
  });

  it('traduit un enregistrement introuvable (P2025) en 404', () => {
    const res = respond(prismaError('P2025', { modelName: 'Organization' }));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, title: 'Not Found' });
    expect(JSON.stringify(res.body)).not.toMatch(/Organization/);
  });

  it('garde un 500 générique pour les autres erreurs Prisma', () => {
    const res = respond(prismaError('P2003'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Erreur interne',
      status: 500,
    });
  });

  it('garde la traduction des HttpException', () => {
    const res = respond(new ConflictException('Ce pack est épuisé.'));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      title: 'Conflict',
      detail: 'Ce pack est épuisé.',
    });
  });
});
