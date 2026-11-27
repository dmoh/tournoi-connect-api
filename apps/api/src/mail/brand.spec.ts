import { withBrand } from './brand.js';

const mail = {
  to: 'a@example.org',
  subject: 'Objet',
  text: 'Texte',
  html: '<!doctype html><html lang="fr"><body style="margin:0"><p>Bonjour</p></body></html>',
};

describe('withBrand', () => {
  it('place le logo de l’application juste après <body>', () => {
    const html = withBrand(mail, 'https://app.example.org/').html;
    expect(html).toMatch(
      /<body style="margin:0">\n<table[^>]*>.*<img src="https:\/\/app\.example\.org\/brand\/logo-email\.png"[^>]*alt="Tournoi Connect"/s,
    );
    expect(html.indexOf('logo-email')).toBeLessThan(html.indexOf('Bonjour'));
  });

  it('laisse intacts le texte brut et un HTML sans <body>', () => {
    expect(withBrand(mail, 'https://app.example.org').text).toBe('Texte');
    const fragment = { ...mail, html: '<p>Bonjour</p>' };
    expect(withBrand(fragment, 'https://app.example.org')).toBe(fragment);
  });
});
