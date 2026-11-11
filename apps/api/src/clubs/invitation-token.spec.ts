import {
  hashInvitationToken,
  maskEmail,
  newInvitationToken,
} from './invitation-token.js';

describe('Jeton d’invitation', () => {
  it('ne garde que l’empreinte du jeton', () => {
    const { token, hash } = newInvitationToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(hash).toBe(hashInvitationToken(token));
    expect(hash).not.toBe(token);
  });

  it('masque l’adresse invitée', () => {
    expect(maskEmail('camille.perrin@example.org')).toBe('c•••@example.org');
  });
});
