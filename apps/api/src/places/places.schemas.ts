import { z } from 'zod';

/** Commune française, telle que l'Explorer et l'assistant la proposent. */
export const placeSchema = z.object({
  /** Identifiant d'URL stable : nom simplifié et code INSEE (« megeve-74173 »). */
  slug: z.string(),
  name: z.string(),
  postcode: z.string(),
  /** Code INSEE de la commune. */
  citycode: z.string(),
  department: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export const placeSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

/**
 * Position de l'appareil, arrondie au kilomètre par l'application (deux
 * décimales) : elle sert à trouver la commune, elle n'est pas gardée.
 */
export const nearestQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const placeListSchema = z.object({ items: z.array(placeSchema) });

export type Place = z.infer<typeof placeSchema>;
export type PlaceSearchQuery = z.infer<typeof placeSearchQuerySchema>;
export type NearestQuery = z.infer<typeof nearestQuerySchema>;
export type PlaceList = z.infer<typeof placeListSchema>;
