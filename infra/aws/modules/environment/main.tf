locals {
  prefix     = "tournoi-connect-${var.name}"
  ssm_prefix = "/tournoi-connect/${var.name}"
  host_path  = "host/${var.name}"
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------- Réseau

resource "aws_security_group" "host" {
  name        = "${local.prefix}-host"
  description = "Serveur ${var.name} : HTTP et HTTPS publics, aucun SSH (acces par SSM)"
  vpc_id      = var.vpc_id
  tags        = { Name = "${local.prefix}-host" }
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  for_each          = toset(["80", "443"])
  security_group_id = aws_security_group.host.id
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Web ${each.value}"
}

resource "aws_vpc_security_group_ingress_rule" "http3" {
  security_group_id = aws_security_group.host.id
  ip_protocol       = "udp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "HTTP/3"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.host.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Sorties - mises a jour, Lets Encrypt, AWS"
}

# ---------------------------------------------------------------- Rôle du serveur

data "aws_iam_policy_document" "ec2_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "${local.prefix}-host"
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

# Agent SSM : commandes de déploiement et session sans port SSH.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "host" {
  statement {
    sid     = "LireSesImagesEtFichiers"
    actions = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = [
      "${var.artifacts_bucket.arn}/images/*/${var.name}.tar.gz",
      "${var.artifacts_bucket.arn}/${local.host_path}/*",
    ]
  }
  statement {
    sid       = "ListerSesFichiers"
    actions   = ["s3:ListBucket"]
    resources = [var.artifacts_bucket.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.host_path}/*", "${local.host_path}/"]
    }
  }
  statement {
    sid     = "LireSesParametres"
    actions = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}",
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}/*",
    ]
  }
  statement {
    sid       = "DechiffrerSesSecrets"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "host" {
  name   = "acces-du-serveur"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host.json
}

resource "aws_iam_instance_profile" "host" {
  name = "${local.prefix}-host"
  role = aws_iam_role.host.name
}

# ---------------------------------------------------------------- Serveur

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "host" {
  ami                    = nonsensitive(data.aws_ssm_parameter.al2023.value)
  instance_type          = var.instance_type
  subnet_id              = var.public_subnet_id
  vpc_security_group_ids = [aws_security_group.host.id]
  iam_instance_profile   = aws_iam_instance_profile.host.name

  # Crédits CPU plafonnés : pas de facturation surprise du mode « unlimited ».
  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
    tags                  = { Name = "${local.prefix}-host" }
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    env    = var.name
    bucket = var.artifacts_bucket.id
    region = data.aws_region.current.region
  })

  tags = { Name = "${local.prefix}-host", Environnement = var.name }

  lifecycle {
    # Une nouvelle AMI ne remplace pas le serveur : mises à jour par dnf.
    ignore_changes = [ami, user_data]
  }

  depends_on = [aws_s3_object.host_files, aws_s3_object.caddyfile]
}

resource "aws_eip" "host" {
  domain = "vpc"
  tags   = { Name = "${local.prefix}-host" }
}

resource "aws_eip_association" "host" {
  instance_id   = aws_instance.host.id
  allocation_id = aws_eip.host.id
}

resource "aws_route53_record" "app" {
  zone_id = var.zone_id
  name    = var.app_host
  type    = "A"
  ttl     = 300
  records = [aws_eip.host.public_ip]
}

resource "aws_route53_record" "api" {
  zone_id = var.zone_id
  name    = var.api_host
  type    = "A"
  ttl     = 300
  records = [aws_eip.host.public_ip]
}

# ---------------------------------------------------------------- Fichiers d'hôte

resource "aws_s3_object" "host_files" {
  for_each = var.host_files
  bucket   = var.artifacts_bucket.id
  key      = "${local.host_path}/${each.key}"
  source   = each.value
  etag     = filemd5(each.value)
}

resource "aws_s3_object" "caddyfile" {
  bucket = var.artifacts_bucket.id
  key    = "${local.host_path}/Caddyfile"
  content = templatefile("${path.module}/Caddyfile.tftpl", {
    app_host  = var.app_host
    api_host  = var.api_host
    indexable = var.indexable
  })
}
