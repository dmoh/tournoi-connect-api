import { placeSlug, toPlace } from './geocoder.js';

describe('géocodeur', () => {
  it('convertit un résultat de la Géoplateforme en commune', () => {
    expect(
      toPlace({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [6.626089, 45.843574] },
        properties: {
          name: 'Megève',
          postcode: '74120',
          citycode: '74173',
          context: '74, Haute-Savoie, Auvergne-Rhône-Alpes',
        },
      }),
    ).toEqual({
      slug: 'megeve-74173',
      name: 'Megève',
      postcode: '74120',
      citycode: '74173',
      department: 'Haute-Savoie',
      lat: 45.843574,
      lng: 6.626089,
    });
    expect(
      toPlace({ properties: { name: 'Sans coordonnées', citycode: '1' } }),
    ).toBeNull();
  });

  it('fabrique un identifiant d’URL lisible et unique', () => {
    expect(placeSlug('Saint-Gervais-les-Bains', '74236')).toBe(
      'saint-gervais-les-bains-74236',
    );
    expect(placeSlug("L'Île-Rousse", '2B134')).toBe('l-ile-rousse-2b134');
  });
});
