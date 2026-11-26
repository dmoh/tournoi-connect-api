import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { Geocoder } from './geocoder.js';
import type { Place } from './places.schemas.js';

/** Réponses gardées en mémoire : les communes changent rarement. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_SIZE = 2000;

/** « megeve-74173 » ; le code INSEE de Corse commence par 2A ou 2B. */
const SLUG = /^([a-z0-9-]+)-(\d[\dab]\d{3})$/;

/**
 * Communes de France pour l'Explorer et l'assistant : recherche au fil de la
 * frappe et lecture d'une commune par son identifiant d'URL. Le géocodeur
 * public est appelé par l'API, jamais par le navigateur : l'adresse IP des
 * visiteurs ne lui parvient pas et la politique de sécurité du site reste
 * fermée. Cache en mémoire (24 h, 2 000 entrées).
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly cache = new Map<string, { at: number; places: Place[] }>();

  constructor(
    private readonly geocoder: Geocoder,
    private readonly clock: Clock,
  ) {}

  search(query: string, limit: number): Promise<Place[]> {
    const q = query.trim().replace(/\s+/g, ' ');
    return this.cached(`q:${q.toLocaleLowerCase('fr')}:${limit}`, () =>
      this.geocoder.municipalities(q, { limit }),
    );
  }

  async bySlug(slug: string): Promise<Place> {
    const match = SLUG.exec(slug.toLowerCase());
    if (!match) {
      throw new NotFoundException('Commune introuvable.');
    }
    const [, name, citycode] = match;
    const places = await this.cached(`c:${citycode}`, () =>
      this.geocoder.municipalities(name!.replace(/-/g, ' '), {
        limit: 1,
        citycode: citycode!.toUpperCase(),
      }),
    );
    const place = places.find((p) => p.citycode.toLowerCase() === citycode);
    if (!place) {
      throw new NotFoundException('Commune introuvable.');
    }
    return place;
  }

  private async cached(
    key: string,
    load: () => Promise<Place[]>,
  ): Promise<Place[]> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      return hit.places;
    }
    let places: Place[];
    try {
      places = await load();
    } catch (error) {
      this.logger.warn(`Recherche de communes impossible : ${String(error)}`);
      throw new ServiceUnavailableException(
        'La recherche de communes est momentanément indisponible.',
      );
    }
    if (this.cache.size >= CACHE_SIZE) {
      // Le plus ancien d'abord (ordre d'insertion de la Map).
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, { at: now, places });
    return places;
  }
}
