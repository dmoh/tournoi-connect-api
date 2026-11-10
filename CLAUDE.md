# Tournoi Connect — API

## Repères

- Espace de travail pnpm 12, Node 26. `apps/api` = API NestJS 12 (Fastify, ESM) ; le worker est `apps/api/src/worker.ts`.
- `packages/engine` : moteur de tournoi pur et déterministe, sans réseau ni base. `packages/contracts` : types générés, ne jamais éditer `src/openapi.ts` à la main.
- Documentation NestJS 12 : https://docs.nestjs.com/llms.txt (version plus récente que les habitudes : vérifier avant d'écrire).

## Règles

- ESM partout : les imports relatifs finissent par `.js`, `__dirname` n'existe pas (`import.meta.dirname`).
- Tests avec Vitest (`vi.fn()`), jamais Jest.
- Toute variable d'environnement passe par `apps/api/src/config/env.ts` (schéma zod) et `.env.example`.
- Données : Prisma 7 (`apps/api/prisma/schema.prisma`), client généré dans `src/generated` (jamais commité, `prisma generate` lancé par build, lint, typecheck et tests). Un changement de schéma = `pnpm db:migrate` et la migration commitée ; jamais `db push`.
- Requêtes et réponses décrites par des schémas zod : `@Body({ schema })`, `@Query({ schema })` et `openApi(schema)` dans les décorateurs Swagger.
- Une ressource privée hors de l'organisation répond 404, jamais 403. Erreurs en `problem+json`.
- Les tests e2e tournent sur une vraie base (`DATABASE_URL`) remise aux données de démonstration (`seedDemo`) ; horloge figée par le fournisseur `Clock`.
- Aucun traitement lourd ni envoi d'email dans une requête HTTP : tout part au worker.
- Routes métier sous `/api/v1` ; chaque route porte ses décorateurs OpenAPI.
- Après un changement de route ou de DTO : `pnpm openapi` puis commiter `apps/api/openapi.json` et `packages/contracts`.
- Aucun secret dans le dépôt ; aucune dépendance ajoutée sans validation.

## Avant de pousser

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`
