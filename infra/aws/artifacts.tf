# Images Docker (archives) et fichiers d'hôte déposés par la CI, lus par les
# serveurs via leur rôle : aucun identifiant de registre sur les serveurs.

resource "aws_s3_bucket" "artifacts" {
  bucket = "tournoi-connect-artifacts-${var.account_id}"
}

resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Une archive courante par service et par environnement
# (images/<service>/<env>.tar.gz), réécrite à chaque déploiement : un serveur
# neuf retrouve toujours la dernière version. Les versions précédentes restent
# 30 jours pour un retour arrière.
resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket     = aws_s3_bucket.artifacts.id
  depends_on = [aws_s3_bucket_versioning.artifacts]

  rule {
    id     = "anciennes-images-30-jours"
    status = "Enabled"
    filter {
      prefix = "images/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}
