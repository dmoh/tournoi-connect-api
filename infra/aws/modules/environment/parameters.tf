# Configuration du serveur dans SSM Parameter Store (niveau standard, gratuit) :
# deploy.sh les recopie dans /opt/tournoi-connect/.env à chaque déploiement.

resource "random_password" "organizer_token" {
  length  = 40
  special = false
}

locals {
  plain_parameters = merge(
    {
      APP_HOST           = var.app_host
      API_HOST           = var.api_host
      PUBLIC_APP_URL     = "https://${var.app_host}"
      NG_ALLOWED_HOSTS   = var.app_host
      REDIS_URL          = "redis://redis:6379"
      LOG_LEVEL          = var.name == "prod" ? "info" : "debug"
      ORGANIZER_DEMO_ORG = "etoile-de-l-arve"
      SEED_DEMO          = var.seed_demo ? "true" : "false"
    },
    var.managed_database ? {} : { COMPOSE_PROFILES = "local-db" },
  )
  secret_parameters = merge(
    {
      DATABASE_URL         = local.database_url
      ORGANIZER_DEMO_TOKEN = random_password.organizer_token.result
    },
    var.managed_database ? {} : { POSTGRES_PASSWORD = random_password.database.result },
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
