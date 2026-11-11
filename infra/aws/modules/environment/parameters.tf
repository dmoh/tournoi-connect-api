# Configuration du serveur dans SSM Parameter Store (niveau standard, gratuit) :
# deploy.sh les recopie dans /opt/tournoi-connect/.env à chaque déploiement.

resource "random_password" "auth_secret" {
  length  = 64
  special = false
}

# Code fixe des comptes de test (@example.org), seulement avec les données de
# démonstration (préprod) : lire avec aws ssm get-parameter --with-decryption.
resource "random_password" "test_accounts_code" {
  count   = var.seed_demo ? 1 : 0
  length  = 6
  special = false
  upper   = false
  lower   = false
  numeric = true
}

locals {
  plain_parameters = merge(
    {
      APP_HOST         = var.app_host
      API_HOST         = var.api_host
      PUBLIC_APP_URL   = "https://${var.app_host}"
      NG_ALLOWED_HOSTS = var.app_host
      REDIS_URL        = "redis://redis:6379"
      LOG_LEVEL        = var.name == "prod" ? "info" : "debug"
      MAIL_TRANSPORT   = "ses"
      MAIL_FROM        = var.mail_from
      AWS_REGION       = data.aws_region.current.region
      SEED_DEMO        = var.seed_demo ? "true" : "false"
    },
    var.managed_database ? {} : { COMPOSE_PROFILES = "local-db" },
    # Active le code fixe des comptes de test ; l'API refuse de démarrer si
    # l'une de ces deux variables existe avec l'URL de production.
    var.seed_demo ? { ALLOW_TEST_ACCOUNTS = "true" } : {},
  )
  secret_parameters = merge(
    {
      DATABASE_URL = local.database_url
      AUTH_SECRET  = random_password.auth_secret.result
    },
    var.managed_database ? {} : { POSTGRES_PASSWORD = random_password.database.result },
    var.seed_demo ? { TEST_ACCOUNTS_CODE = random_password.test_accounts_code[0].result } : {},
  )
}

resource "aws_ssm_parameter" "plain" {
  for_each = local.plain_parameters
  name     = "${local.ssm_prefix}/${each.key}"
  type     = "String"
  value    = each.value
}

resource "aws_ssm_parameter" "secret" {
  for_each = nonsensitive(toset(keys(local.secret_parameters)))
  name     = "${local.ssm_prefix}/${each.key}"
  type     = "SecureString"
  value    = local.secret_parameters[each.key]
}
