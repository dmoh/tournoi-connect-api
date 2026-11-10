# Déploiement depuis GitHub Actions par OIDC : aucune clé AWS dans GitHub.
# Le rôle d'un environnement n'est assumable que par un job qui déclare
# l'environnement GitHub correspondant (preprod ou production).

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  deploy_targets = {
    preprod = { github_environment = "preprod", instance_arn = module.preprod.instance_arn }
    prod    = { github_environment = "production", instance_arn = module.prod.instance_arn }
  }
}

data "aws_iam_policy_document" "github_trust" {
  for_each = local.deploy_targets
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for repo in var.github_repositories : "repo:${repo}:environment:${each.value.github_environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each             = local.deploy_targets
  name                 = "tournoi-connect-deploy-${each.key}"
  assume_role_policy   = data.aws_iam_policy_document.github_trust[each.key].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  for_each = local.deploy_targets

  statement {
    sid       = "DeposerLesImages"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/images/*/${each.key}.tar.gz"]
  }
  statement {
    sid     = "LancerLeDeploiement"
    actions = ["ssm:SendCommand"]
    resources = [
      each.value.instance_arn,
      "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
    ]
  }
  statement {
    sid       = "SuivreLeDeploiement"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ec2:DescribeInstances"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = each.key == "prod" ? [1] : []
    content {
      sid       = "PublierLaVitrine"
      actions   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      resources = [module.vitrine.bucket_arn, "${module.vitrine.bucket_arn}/*"]
    }
  }
  dynamic "statement" {
    for_each = each.key == "prod" ? [1] : []
    content {
      sid       = "RafraichirLaVitrine"
      actions   = ["cloudfront:CreateInvalidation"]
      resources = [module.vitrine.distribution_arn]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = local.deploy_targets
  name     = "deploiement"
  role     = aws_iam_role.deploy[each.key].id
  policy   = data.aws_iam_policy_document.deploy[each.key].json
}
