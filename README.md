# Tournoi Connect — API

API, worker, moteur de tournoi et contrats de la plateforme Tournoi Connect.
Le front (PWA Angular) vit dans [tournoi-connect-front](https://github.com/dmoh/tournoi-connect-front).

## Stack

- Node 26 LTS, pnpm 12 (espace de travail)
- NestJS 12 en ESM sur Fastify 5, TypeScript 6 strict
- PostgreSQL 17 et Prisma 7 (pilote `pg`, migrations versionnées), ADR-002 et ADR-003
- Validation par schémas zod (pipe Standard Schema natif de NestJS 12) ; les mêmes schémas produisent le contrat OpenAPI
- Erreurs au format `application/problem+json`, sondes de santé `@nestjs/terminus`
- Vitest (unitaires et e2e), oxlint, Prettier

## Structure

```text
apps/api/            API NestJS ; le worker est le même code démarré par src/worker.ts
packages/engine/     moteur de tournoi, TypeScript pur → @dmoh/tournoi-connect-engine
packages/contracts/  types générés depuis apps/api/openapi.json → @dmoh/tournoi-connect-contracts
infra/               docker-compose local, Dockerfile (API et worker)
docs/adr/            décisions d'architecture
.github/workflows/   CI (ci.yml), CD (cd.yml, deploy.yml)
```

## Démarrer

```bash
nvm use                 # Node 26
npm install -g pnpm@12.18.0
pnpm install
cp .env.example .env
pnpm infra:up           # Postgres + PostGIS, Redis, Mailpit, MinIO
pnpm db:deploy          # applique les migrations
pnpm build && pnpm db:seed   # données de démonstration (jamais en production)
pnpm dev                # API sur http://localhost:3000 — Swagger sur /api/docs
pnpm dev:worker         # worker
```

## Commandes

| Commande                      | Rôle                                                |
| ----------------------------- | --------------------------------------------------- |
| `pnpm lint`                   | oxlint sur tous les paquets                         |
| `pnpm typecheck`              | `tsc --noEmit` sur tous les paquets                 |
| `pnpm test` / `pnpm test:e2e` | tests unitaires / e2e                               |
| `pnpm build`                  | build de l'API et des paquets                       |
| `pnpm openapi`                | régénère `openapi.json` et les types de `contracts` |
| `pnpm db:migrate`             | crée une migration depuis `prisma/schema.prisma`    |
| `pnpm db:deploy`              | applique les migrations                             |
| `pnpm db:seed`                | charge les données de démonstration                 |
| `pnpm format`                 | Prettier                                            |

## CI/CD

- **CI** (`ci.yml`, chaque pull request et chaque push sur `main`) : format, lint, types, tests unitaires et e2e, build, contrat OpenAPI à jour, gitleaks, audit des dépendances, build de l'image.
- **CD** (`cd.yml`) :
  - push sur `main` → image `ghcr.io/dmoh/tournoi-connect-api:preprod`, puis déploiement en préprod (https://api.preprod.tournoi-connect.com) ;
  - tag `vX.Y.Z` → image versionnée, publication de `@dmoh/tournoi-connect-engine` et `@dmoh/tournoi-connect-contracts` sur GitHub Packages, puis déploiement en production (https://api.tournoi-connect.com).
- **Déploiement** (`deploy.yml`) : rôle IAM assumé par OIDC (aucune clé AWS dans GitHub), archive de l'image déposée dans S3, puis `deploy.sh` lancé sur le serveur par SSM : migrations Prisma, puis API et worker relancés.
- **Infrastructure** : Terraform dans [`infra/aws`](infra/aws/README.md) (réseau, serveurs, RDS, DNS, vitrine, rôles OIDC, coûts).
- Pour exiger une validation manuelle avant la production : Settings → Environments → `production` → Required reviewers.

## Routes disponibles

Préfixe `/api/v1` ; détail et schémas dans Swagger (`/api/docs`) et `apps/api/openapi.json`.

| Route                                            | Accès        | Rôle                                                               |
| ------------------------------------------------ | ------------ | ------------------------------------------------------------------ |
| `GET /health/live`, `GET /health/ready`          | public       | sondes (ready vérifie Postgres)                                    |
| `GET /public/tournaments?lat&lng&radiusKm&sport` | public       | tournois en cours ou à venir dans le rayon, par distance puis date |
| `GET /public/tournaments/:slug`                  | public       | page publique : équipes, matchs, classements (moteur)              |
| `GET /public/tournaments/:slug/news`             | public       | fil News, une carte sponsorisée au plus pour quatre éléments       |
| `GET /public/tournaments/:slug/sponsors`         | public       | bannière Or, bandeau partagé (6 au plus), sponsors de terrain      |
| `POST /public/posts/:postId/votes`               | public       | vote à un sondage                                                  |
| `POST /public/audience`                          | public       | impression ou clic d'un sponsor, cumulé par heure                  |
| `GET /organizer/tournaments/:slug/sponsors`      | organisateur | packs, sponsors et audience, prospects du club                     |
| `POST /organizer/tournaments/:slug/sponsors`     | organisateur | inviter un sponsor (pack épuisé : 409)                             |
| `PATCH /organizer/tournament-sponsors/:id`       | organisateur | marquer payé hors Stripe                                           |
| `POST /organizer/tournaments/:slug/posts`        | organisateur | publier une annonce ou un sondage                                  |

## Décisions provisoires

| Décision                                                                   | Pourquoi                                                              | Remplacée par                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Distance haversine en SQL, préfiltrée par une boîte lat/lng indexée        | Démarrer sans PostGIS ; résultats identiques à l'échelle d'une région | `ST_DWithin` et index GiST (plan, section 4)             |
| Dédoublonnage des impressions par session côté PWA                         | Redis ne sert encore qu'aux files BullMQ                              | Clé Redis par session et emplacement                     |
| Sans `REDIS_URL`, les événements d'audience s'écrivent directement en base | Tests et poste local sans Redis                                       | Redis obligatoire hors tests                             |
| Classements calculés à la lecture avec `computeStandings` du moteur        | Volume de démonstration                                               | Classements matérialisés à la validation d'un score (P4) |
