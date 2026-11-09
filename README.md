# Tournoi Connect — API

API, worker, moteur de tournoi et contrats de la plateforme Tournoi Connect.
Le front (PWA Angular) vit dans [tournoi-connect-front](https://github.com/dmoh/tournoi-connect-front).

## Stack

- Node 26 LTS, pnpm 12 (espace de travail)
- NestJS 12 en ESM sur Fastify 5, TypeScript 6 strict
- Validation de configuration par zod, sondes de santé `@nestjs/terminus`, contrat OpenAPI `@nestjs/swagger`
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
| `pnpm format`                 | Prettier                                            |

## CI/CD

- **CI** (`ci.yml`, chaque pull request et chaque push sur `main`) : format, lint, types, tests unitaires et e2e, build, contrat OpenAPI à jour, gitleaks, audit des dépendances, build de l'image.
- **CD** (`cd.yml`) :
  - push sur `main` → image `ghcr.io/dmoh/tournoi-connect-api:staging`, puis déploiement en homologation ;
  - tag `vX.Y.Z` → image versionnée, publication de `@dmoh/tournoi-connect-engine` et `@dmoh/tournoi-connect-contracts` sur GitHub Packages, puis déploiement en production.
- Le déploiement AWS (`deploy.yml`, App Runner via ECR et OIDC) est **ignoré tant que la variable de dépôt `AWS_ROLE_ARN` n'existe pas**. Les variables à créer sont listées en tête de `deploy.yml`.
- Pour exiger une validation manuelle avant la production : Settings → Environments → `production` → Required reviewers.

## Routes disponibles

- `GET /health/live` — sonde de vie
- `GET /health/ready` — sonde de disponibilité
- `GET /api/docs` — Swagger UI (hors production)
- Les routes métier sont préfixées `/api/v1`.
