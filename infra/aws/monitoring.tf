# Surveillance de disponibilité : Route 53 sonde chaque minute l'API (base et
# Redis compris, /health/ready) et la PWA depuis plusieurs régions ; une
# alarme CloudWatch prévient par email après 3 minutes d'échec, puis au
# rétablissement. Les métriques des sondes n'existent qu'en us-east-1.

locals {
  health_checks = {
    "prod-api"    = { host = "api.${var.domain}", path = "/health/ready" }
    "prod-app"    = { host = "app.${var.domain}", path = "/" }
    "preprod-api" = { host = "api.preprod.${var.domain}", path = "/health/ready" }
  }
}

resource "aws_route53_health_check" "site" {
  for_each = local.health_checks

  type              = "HTTPS"
  fqdn              = each.value.host
  port              = 443
  resource_path     = each.value.path
  request_interval  = 30
  failure_threshold = 3
  measure_latency   = false
  tags              = { Name = "tournoi-connect-${each.key}" }
}

resource "aws_sns_topic" "alerts" {
  provider = aws.us_east_1
  name     = "tournoi-connect-alertes"
}

# L'adresse reçoit d'abord un email de confirmation d'AWS : cliquer le lien
# active l'abonnement.
resource "aws_sns_topic_subscription" "alerts_email" {
  provider  = aws.us_east_1
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "site_down" {
  provider = aws.us_east_1
  for_each = local.health_checks

  alarm_name          = "tournoi-connect-${each.key}-indisponible"
  alarm_description   = "https://${each.value.host}${each.value.path} ne répond plus."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.site[each.key].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
