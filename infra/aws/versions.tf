terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  # État chiffré et versionné, verrou natif S3 (pas de table DynamoDB).
  # Le bucket est créé une fois par bootstrap.sh.
  backend "s3" {
    bucket       = "tournoi-connect-tfstate-677142166254"
    key          = "aws/terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true
  }
}

locals {
  # Étiquettes posées sur tout ce que Terraform crée : elles isolent le projet
  # des autres ressources du compte (garde-fous IAM) et alimentent le budget.
  default_tags = {
    Projet   = "tournoi-connect"
    GereePar = "terraform"
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = local.default_tags
  }
}

# CloudFront n'accepte que des certificats émis en us-east-1.
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = local.default_tags
  }
}
