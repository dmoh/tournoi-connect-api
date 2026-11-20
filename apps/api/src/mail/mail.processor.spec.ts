import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MailMessage, MailSender } from './mail-sender.js';
import { MailProcessor, maskEmails } from './mail.processor.js';

const sesDenied = Object.assign(
  new Error(
    "User 'arn:aws:sts::123456789012:assumed-role/tournoi-connect-prod-host/i-0abc' is not authorized to perform 'ses:SendEmail' on resource 'arn:aws:ses:eu-west-3:123456789012:identity/camille.durand@example.org'",
  ),
  { name: 'AccessDeniedException' },
);

function job(attemptsMade: number, attempts = 5): Job<MailMessage> {
  return {
    id: '42',
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<MailMessage>;
}

describe('maskEmails', () => {
  it('garde le domaine et masque la boîte', () => {
    expect(maskEmails('identity/camille.durand@example.org refusée')).toBe(
      'identity/c***@example.org refusée',
    );
  });

  it('laisse un texte sans adresse intact', () => {
    expect(maskEmails('Throttling: Maximum sending rate exceeded')).toBe(
      'Throttling: Maximum sending rate exceeded',
    );
  });
});

describe('MailProcessor.onFailed', () => {
  const processor = new MailProcessor({
    send: vi.fn(),
  } as unknown as MailSender);

  afterEach(() => vi.restoreAllMocks());

  it('journalise un essai raté en avertissement, sans l’adresse du destinataire', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    processor.onFailed(job(2), sesDenied);

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('Email 42 non envoyé (essai 2/5)');
    expect(line).toContain('AccessDeniedException');
    expect(line).toContain('ses:SendEmail');
    expect(line).not.toContain('camille.durand');
  });

  it('journalise le dernier essai en erreur, avec l’abandon', () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    processor.onFailed(job(5), sesDenied);

    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain('essai 5/5, abandon');
  });
});
