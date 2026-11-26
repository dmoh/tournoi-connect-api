import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Place } from './places.schemas.js';

/** Recherche de communes ; remplacée par un faux dans les tests (aucun réseau). */
export abstract class Geocoder {
  /** Communes dont le nom ressemble à `query`, les plus probables d'abord. */
  abstract municipalities(
    query: string,
    options: { limit: number; citycode?: string },
  ): Promise<Place[]>;

  /** Commune la plus proche d'un point, ou null en mer ou hors de France. */
  abstract nearest(lat: number, lng: number): Promise<Place | null>;
}

/** Délai au-delà duquel le géocodeur est jugé indisponible. */
const TIMEOUT_MS = 3000;

/**
 * Géoplateforme de l'IGN (service public, gratuit, sans clé, successeur de
 * l'API Adresse) : `GET /search?q=&type=municipality`.
 */
@Injectable()
export class GeoplateformeGeocoder extends Geocoder {
  private readonly logger = new Logger(GeoplateformeGeocoder.name);
  private readonly base: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.base = config.get('GEOCODER_URL', { infer: true }).replace(/\/$/, '');
  }

  async municipalities(
    query: string,
    options: { limit: number; citycode?: string },
  ): Promise<Place[]> {
    const url = new URL(`${this.base}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'municipality');
    url.searchParams.set('limit', String(options.limit));
    if (options.citycode) {
      url.searchParams.set('citycode', options.citycode);
    }
    return this.places(url);
  }

  async nearest(lat: number, lng: number): Promise<Place | null> {
    const url = new URL(`${this.base}/reverse`);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('type', 'municipality');
    url.searchParams.set('limit', '1');
    return (await this.places(url))[0] ?? null;
  }

  private async places(url: URL): Promise<Place[]> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      this.logger.warn(`Géocodeur : HTTP ${response.status}.`);
      throw new Error(`Géocodeur indisponible (${response.status}).`);
    }
    const body = (await response.json()) as { features?: unknown[] };
    return (body.features ?? []).flatMap((feature) => {
      const place = toPlace(feature);
      return place ? [place] : [];
    });
  }
}

/** Commune d'un résultat GeoJSON, ou null s'il lui manque un champ. */
export function toPlace(feature: unknown): Place | null {
  const f = feature as {
    geometry?: { coordinates?: unknown[] };
    properties?: Record<string, unknown>;
  };
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const name = typeof p['name'] === 'string' ? p['name'] : null;
  const citycode = typeof p['citycode'] === 'string' ? p['citycode'] : null;
  if (
    !name ||
    !citycode ||
    typeof lat !== 'number' ||
    typeof lng !== 'number'
  ) {
    return null;
  }
  const context = typeof p['context'] === 'string' ? p['context'] : '';
  return {
    slug: placeSlug(name, citycode),
    name,
    postcode: typeof p['postcode'] === 'string' ? p['postcode'] : '',
    citycode,
    // « 74, Haute-Savoie, Auvergne-Rhône-Alpes » → « Haute-Savoie ».
    department: context.split(',')[1]?.trim() ?? '',
    lat,
    lng,
  };
}

/** « Saint-Gervais-les-Bains », 74236 → « saint-gervais-les-bains-74236 ». */
export function placeSlug(name: string, citycode: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-${citycode.toLowerCase()}`;
}
