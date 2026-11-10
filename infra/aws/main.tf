data "aws_route53_zone" "main" {
  name = var.domain
}

locals {
  host_files = {
    "compose.yml" = "${path.module}/host/compose.yml"
    "deploy.sh"   = "${path.module}/host/deploy.sh"
  }
  artifacts_bucket = { id = aws_s3_bucket.artifacts.id, arn = aws_s3_bucket.artifacts.arn }
}

# Préprod : tout sur un serveur, Postgres en conteneur, données de démonstration.
module "preprod" {
  source = "./modules/environment"

  name               = "preprod"
  app_host           = "preprod.${var.domain}"
  api_host           = "api.preprod.${var.domain}"
  zone_id            = data.aws_route53_zone.main.zone_id
  vpc_id             = aws_vpc.main.id
  public_subnet_id   = aws_subnet.public[0].id
  private_subnet_ids = aws_subnet.private[*].id
  instance_type      = var.instance_type
  artifacts_bucket   = local.artifacts_bucket
  managed_database   = false
  seed_demo          = true
  indexable          = false
  host_files         = local.host_files
  ses_identity_arn   = aws_sesv2_email_identity.domain.arn
  mail_from          = "Tournoi Connect <noreply@${var.domain}>"
}

# Prod : un serveur pour la PWA, l'API, le worker BullMQ et Redis ; base RDS.
module "prod" {
  source = "./modules/environment"

  name               = "prod"
  app_host           = "app.${var.domain}"
  api_host           = "api.${var.domain}"
  zone_id            = data.aws_route53_zone.main.zone_id
  vpc_id             = aws_vpc.main.id
  public_subnet_id   = aws_subnet.public[1].id
  private_subnet_ids = aws_subnet.private[*].id
  instance_type      = var.instance_type
  artifacts_bucket   = local.artifacts_bucket
  managed_database   = true
  indexable          = true
  host_files         = local.host_files
  ses_identity_arn   = aws_sesv2_email_identity.domain.arn
  mail_from          = "Tournoi Connect <noreply@${var.domain}>"
}

# Seules Amazon (CloudFront) et Let's Encrypt (Caddy) peuvent émettre des
# certificats pour le domaine.
resource "aws_route53_record" "caa" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"amazon.com\"",
    "0 issue \"letsencrypt.org\"",
    "0 issuewild \";\"",
  ]
}

module "vitrine" {
  source    = "./modules/vitrine"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  domain      = var.domain
  zone_id     = data.aws_route53_zone.main.zone_id
  bucket_name = "tournoi-connect-vitrine-${var.account_id}"
}
