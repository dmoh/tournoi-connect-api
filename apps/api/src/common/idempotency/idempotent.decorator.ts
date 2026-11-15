import { applyDecorators, UseInterceptors } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

/**
 * Écriture connectée rejouable par l'en-tête Idempotency-Key (facultatif) :
 * un renvoi de la même clé pendant 24 heures rend la première réponse, sans
 * refaire l'écriture. Voir `IdempotencyInterceptor`.
 *
 * Le 409 « requête de même clé en cours » est à décrire sur la route, avec
 * ses propres conflits (une seule réponse 409 par route dans OpenAPI).
 */
export const Idempotent = () =>
  applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'Clé unique de la demande (8 à 100 caractères : lettres, chiffres, _ ou -). La même clé rejoue la première réponse pendant 24 heures.',
    }),
    ApiBadRequestResponse({ description: 'Idempotency-Key invalide' }),
    ApiUnprocessableEntityResponse({
      description: 'Idempotency-Key déjà utilisée pour un autre corps',
    }),
  );
