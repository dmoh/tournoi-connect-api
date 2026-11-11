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

## Comptes de test

Créés par `seedDemo` (poste local, tests e2e, préprod). Connexion par code :

- **en local**, le code s'affiche dans le journal de l'API (`MAIL_TRANSPORT=log`) ;
- **en préprod**, aucun email ne part vers ces adresses ; le code fixe se lit dans SSM :
  `aws ssm get-parameter --with-decryption --name /tournoi-connect/preprod/TEST_ACCOUNTS_CODE --query Parameter.Value --output text`.
  Il faut toujours demander un code avant de le saisir, et les limites (5 essais par code, 5 codes par heure, 20 essais ratés par adresse sur 24 heures) s'appliquent.

Le code fixe n'est actif qu'avec `ALLOW_TEST_ACCOUNTS=true` (posé par Terraform en préprod, avec `seed_demo`) ; sans ce drapeau, `TEST_ACCOUNTS_CODE` est ignoré et les comptes de test reçoivent un code ordinaire. L'API refuse de démarrer si `TEST_ACCOUNTS_CODE` ou `ALLOW_TEST_ACCOUNTS` est renseigné avec `PUBLIC_APP_URL=https://app.tournoi-connect.com`, et si `MAIL_TRANSPORT=log` (valeur par défaut) est gardé avec une PWA en https hors localhost.

| Adresse                  | Personne       | Rôle                                                                           |
| ------------------------ | -------------- | ------------------------------------------------------------------------------ |
| `orga@example.org`       | Camille Perrin | Propriétaire de l'Étoile de l'Arve                                             |
| `admin@example.org`      | Nadia Lambert  | Admin de l'Étoile de l'Arve (sponsors, annonces, tournois)                     |
| `benevole@example.org`   | Hugo Garcia    | Bénévole de l'Étoile de l'Arve (liens rapporteur)                              |
| `multi@example.org`      | Julien Favre   | Propriétaire du Stade du Mont-Blanc et bénévole de l'Étoile (`X-Organization`) |
| `sponsor@example.org`    | Inès Roux      | Accès sponsor de la Fromagerie des Aravis                                      |
| `plateforme@example.org` | Sarah Morel    | Admin plateforme                                                               |
| `spectateur@example.org` | Paul Bernard   | Aucun rôle (spectateur connecté)                                               |

Toute autre adresse crée un compte neuf au premier code (prénom et nom demandés). Le responsable d'équipe (lot 4) et le rapporteur (lien signé, sans compte) n'ont pas de compte dédié.

## Routes disponibles

Préfixe `/api/v1` ; détail et schémas dans Swagger (`/api/docs`) et `apps/api/openapi.json`.

| Route                                                                 | Accès        | Rôle                                                               |
| --------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| `GET /health/live`, `GET /health/ready`                               | public       | sondes (ready vérifie Postgres)                                    |
| `GET /public/tournaments?lat&lng&radiusKm&sport`                      | public       | tournois en cours ou à venir dans le rayon, par distance puis date |
| `GET /public/tournaments/:slug`                                       | public       | page publique : équipes, matchs, classements (moteur)              |
| `GET /public/tournaments/:slug/news`                                  | public       | fil News, une carte sponsorisée au plus pour quatre éléments       |
| `GET /public/tournaments/:slug/sponsors`                              | public       | bannière Or, bandeau partagé (6 au plus), sponsors de terrain      |
| `POST /public/posts/:postId/votes`                                    | public       | vote à un sondage                                                  |
| `POST /public/audience`                                               | public       | impression ou clic d'un sponsor, cumulé par heure                  |
| `PUT /organizer/tournaments/:slug/schedule`                           | admin        | publier le planning (terrain et heure des matchs à venir)          |
| `DELETE /organizer/tournaments/:slug/matches/:matchId/reporter-links` | bénévole     | révoquer les liens de la table de marque d'un match                |
| `GET /public/registrations/:code`                                     | public       | lien d'inscription : prix avec frais, places, paiements du club    |
| `POST /tournaments/:code/registrations`                               | connecté     | inscrire son équipe (Idempotency-Key) : payée, gratuite ou attente |
| `GET /registrations`, `GET /registrations/:id`                        | connecté     | mes équipes (responsable d'équipe)                                 |
| `POST /registrations/:id/checkout`                                    | connecté     | reprendre un paiement expiré, s'il reste une place                 |
| `POST /payments/stripe/webhook`                                       | Stripe       | paiement confirmé ou remboursé, expiré, compte validé (signature)   |
| `GET /organizer/tournaments/:slug/registrations`                      | admin        | inscriptions d'un tournoi du club                                  |
| `GET /organizer/payments`                                             | admin        | paiements en ligne du club (Stripe Connect)                        |
| `POST /organizer/payments/onboarding`                                 | propriétaire | lien d'activation des paiements (vérification Stripe)              |
| `GET /push/config`                                                    | public       | clé publique VAPID (null sans notifications)                       |
| `PUT /push/subscriptions`                                             | public       | abonner ce navigateur (suivis, préférences ; compte si connecté)   |
| `POST /push/subscriptions/delete`                                     | public       | désabonner ce navigateur                                           |
| `GET`, `PUT /me/follows`                                              | connecté     | suivis du compte (tournois, équipes « slug/code »)                 |
| `POST /me/follows/merge`                                              | connecté     | ajouter les suivis de l'appareil à ceux du compte                  |
| `POST /clubs`                                                         | connecté     | créer un club (on en devient propriétaire)                         |
| `GET /organizer/members`                                              | bénévole     | membres du club et invitations en attente                          |
| `POST /organizer/invitations`                                         | admin        | inviter par email (lien de 7 jours, réservé à l'adresse)           |
| `DELETE /organizer/invitations/:id`                                   | admin        | annuler une invitation                                             |
| `PATCH /organizer/members/:userId`                                    | propriétaire | changer un rôle (toujours un propriétaire au moins)                |
| `DELETE /organizer/members/:userId`                                   | bénévole     | quitter le club, ou retirer un membre de rôle inférieur            |
| `GET /invitations/:token`                                             | public       | invitation lue par son lien (adresse masquée)                      |
| `POST /invitations/:token/accept`                                     | connecté     | rejoindre le club, avec le compte de l'adresse invitée             |
| `GET /organizer/tournaments/:slug/sponsors`                           | organisateur | packs, sponsors et audience, prospects du club                     |
| `POST /organizer/tournaments/:slug/sponsors`                          | organisateur | inviter un sponsor (pack épuisé : 409)                             |
| `PATCH /organizer/tournament-sponsors/:id`                            | organisateur | marquer payé hors Stripe                                           |
| `POST /organizer/tournaments/:slug/posts`                             | organisateur | publier une annonce ou un sondage                                  |

## Décisions provisoires

| Décision                                                                   | Pourquoi                                                              | Remplacée par                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Distance haversine en SQL, préfiltrée par une boîte lat/lng indexée        | Démarrer sans PostGIS ; résultats identiques à l'échelle d'une région | `ST_DWithin` et index GiST (plan, section 4)             |
| Dédoublonnage des impressions par session côté PWA                         | Redis ne sert encore qu'aux files BullMQ                              | Clé Redis par session et emplacement                     |
| Sans `REDIS_URL`, les événements d'audience s'écrivent directement en base | Tests et poste local sans Redis                                       | Redis obligatoire hors tests                             |
| Classements calculés à la lecture avec `computeStandings` du moteur        | Volume de démonstration                                               | Classements matérialisés à la validation d'un score (P4) |
