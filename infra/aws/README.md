# Infrastructure AWS

Terraform pour la préprod, la prod et le site vitrine de Tournoi Connect, dans le compte `677142166254` (région Paris, `eu-west-3`). Tout ce qui est créé porte l'étiquette `Projet=tournoi-connect` : c'est elle qui sépare le projet des autres ressources du compte (stratégie IAM `tournoi-connect-garde-fous`) et qui alimente le budget.

## Ce qui tourne

| Adresse                                 | Service                    | Où                                                   |
| --------------------------------------- | -------------------------- | ---------------------------------------------------- |
| https://tournoi-connect.com             | site vitrine statique      | S3 privé + CloudFront, certificat ACM (us-east-1)    |
| https://app.tournoi-connect.com         | PWA (SSR Angular), prod    | serveur `tournoi-connect-prod-host`                  |
| https://api.tournoi-connect.com         | API NestJS + worker BullMQ | même serveur, base RDS `tournoi-connect-prod`        |
| https://preprod.tournoi-connect.com     | PWA, préprod (non indexée) | serveur `tournoi-connect-preprod-host`               |
| https://api.preprod.tournoi-connect.com | API + worker, préprod      | même serveur, Postgres en conteneur, données de démo |

Chaque serveur (EC2 `t3a.small`, Amazon Linux 2023, crédits CPU plafonnés) fait tourner `host/compose.yml` : Caddy (HTTPS Let's Encrypt automatique), front, API, worker, Redis (AOF, `noeviction` pour BullMQ) et, en préprod, Postgres. Aucun port SSH : l'accès se fait par SSM.

```
GitHub Actions ──OIDC──▶ rôle tournoi-connect-deploy-<env>
      │ image GHCR → s3://tournoi-connect-artifacts-…/images/<service>/<env>.tar.gz
      └─ ssm send-command ──▶ /opt/tournoi-connect/deploy.sh <service>
                                 ├─ fichiers d'hôte (S3) et .env (SSM Parameter Store)
                                 ├─ docker load, prisma migrate deploy, seed (préprod)
                                 └─ docker compose up -d
```

## Coût estimé (prix publics, Paris)

| Poste                                         | ≈ $/mois |
| --------------------------------------------- | -------: |
| 2 × EC2 t3a.small                             |       32 |
| 2 × EBS gp3 20 Go                             |        4 |
| 2 × IPv4 publique (adresse élastique)         |        7 |
| RDS db.t4g.micro + 20 Go gp3, sauvegardes 7 j |       16 |
| Route 53 (zone + requêtes), S3, CloudFront    |        1 |
| 3 sondes Route 53 HTTPS, 3 alarmes CloudWatch |        5 |
| **Total**                                     | **≈ 65** |

Plus le domaine (≈ 15 $/an). Le budget AWS `tournoi-connect-mensuel` (85 $, filtré sur l'étiquette `Projet`) prévient par email à 50, 80 et 100 % et en cas de dépassement prévu.

## Opérations

```bash
export TF_CLI_CONFIG_FILE=…   # seulement si le registre Terraform n'est pas joignable (miroir local)
cd infra/aws
terraform init
terraform plan -out=plan.tfplan   # relire : aucune destruction attendue hors remplacement voulu
terraform apply plan.tfplan
```

- **Déployer** : merge sur `main` (préprod) ou tag `vX.Y.Z` (prod) dans chaque dépôt ; à la main, `aws ssm send-command` avec `/opt/tournoi-connect/deploy.sh front|api|all|config`.
- **Changer un réglage** : modifier `modules/environment/parameters.tf`, `terraform apply`, puis `deploy.sh config` (ou le prochain déploiement).
- **Shell sur un serveur** : `aws ssm start-session --target <instance>` (plugin Session Manager).
- **Journaux** : `docker compose logs` sur le serveur (rotation 3 × 10 Mo par conteneur).
- **Serveur remplacé** : `terraform apply -replace=module.<env>.aws_instance.host` ; au démarrage, il recharge les dernières images de S3.
- **Retour arrière** : redéployer un commit antérieur (les archives précédentes restent 30 jours, versions S3).
- **Emails (SES)** : le domaine est vérifié par DKIM (`email.tf`). Tant que le compte est dans le bac à sable SES, seules les adresses vérifiées reçoivent les codes (`aws sesv2 create-email-identity --email-identity <adresse>`) ; sortir du bac à sable par la console SES (« Request production access », usage transactionnel : codes de connexion et invitations).
- **Notifications web push** : générer une paire VAPID (`pnpm --filter api vapid:keys`) et la déposer dans SSM (`VAPID_PUBLIC_KEY` en String, `VAPID_PRIVATE_KEY` en SecureString), une paire par environnement, puis `deploy.sh config`. Changer de paire désabonne tous les navigateurs.
- **Paiements (Stripe Connect)** : activer Connect sur le compte Stripe (Express), puis déposer dans SSM `STRIPE_SECRET_KEY` (clé `sk_test_…` en préprod, `sk_live_…` en prod) puis créer dans Stripe (Développeurs, Webhooks) deux points de réception sur `https://<app>/api/v1/payments/stripe/webhook` : un pour le compte (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`), son secret dans `STRIPE_WEBHOOK_SECRET` ; un pour les comptes connectés (`account.updated`), son secret dans `STRIPE_CONNECT_WEBHOOK_SECRET`. Puis `deploy.sh config`.
- **Alertes de disponibilité** (`monitoring.tf`) : Route 53 sonde l'API de prod et de préprod (`/health/ready`, base et Redis compris) et la PWA de prod ; après 3 minutes d'échec, une alarme CloudWatch (us-east-1) écrit au sujet SNS `tournoi-connect-alertes`, puis au retour. L'adresse destinataire n'est pas dans le dépôt : `TF_VAR_alert_email=<adresse> terraform plan`, puis cliquer le lien de confirmation envoyé par AWS.
- **Purge des données** : le worker purge chaque nuit à 4 h (Paris) les codes de connexion, sessions, invitations, inscriptions jamais payées et abonnements push arrivés au bout de leur conservation (`apps/api/src/maintenance`).
- **Connexion Google, Apple, Facebook** : créer l'application chez le fournisseur avec l'URL de retour `https://<app>/api/v1/auth/oauth/<google|apple|facebook>/callback`, puis déposer les identifiants dans SSM (`aws ssm put-parameter --type SecureString --name /tournoi-connect/<env>/GOOGLE_CLIENT_SECRET …`, mêmes noms que `.env.example` ; la clé Apple sur une ligne, sauts de ligne écrits `\n`) et lancer `deploy.sh config`. Sans identifiants, le bouton n'apparaît pas.

## Décisions (budget de 80 €/mois)

| Décision                                                                  | Pourquoi                                                 | Évolution prévue                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Un serveur Docker Compose par environnement plutôt que Fargate/App Runner | ≈ 16 $/mois par environnement, tout compris              | ECS Fargate derrière un ALB quand le trafic le justifie |
| Redis en conteneur (AOF sur disque) plutôt qu'ElastiCache                 | ElastiCache coûterait autant qu'un serveur               | ElastiCache, ou Valkey serverless                       |
| RDS une zone, sans réplique                                               | Multi-AZ double le prix de la base                       | `multi_az = true`                                       |
| Postgres en conteneur en préprod                                          | Données de démonstration rechargées à chaque déploiement | RDS si la préprod garde des données                     |
| Images transmises par S3 plutôt qu'ECR                                    | Aucun identifiant de registre sur les serveurs           | ECR (et `docker pull`) avec Fargate                     |
| `sslmode=no-verify` vers RDS                                              | Trafic chiffré interne au VPC ; CA RDS absente de Node   | Bundle CA RDS dans l'image et `verify-full`             |
| Pas de NAT : sous-réseaux privés réservés à RDS                           | Une passerelle NAT coûte ≈ 35 $/mois                     | —                                                       |
| HTTPS par Caddy sur chaque serveur                                        | Pas d'ALB (≈ 18 $/mois)                                  | ALB + ACM avec Fargate                                  |
