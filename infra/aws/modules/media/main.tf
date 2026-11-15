# Photos des tournois : bucket S3 privé, envoi direct depuis la PWA par URL
# signée (CORS limité à l'application), diffusion par CloudFront (OAC) sur
# un domaine dédié. Les objets sont effacés par le worker de l'API.

resource "aws_s3_bucket" "media" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Seul l'envoi signé (PUT) vient du navigateur ; la lecture passe par CloudFront.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${var.app_host}"]
    allowed_headers = ["content-type"]
    max_age_seconds = 3600
  }
}

# Filet de sécurité : un envoi multipart abandonné ne reste pas facturé.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "envois-abandonnes"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_acm_certificate" "media" {
  provider          = aws.us_east_1
  domain_name       = var.media_host
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.media.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  }
  zone_id         = var.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 300
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "media" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.media.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = var.bucket_name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Une heure au plus en cache : une photo retirée ou masquée par la
# modération disparaît dans l'heure, sans invalidation.
resource "aws_cloudfront_cache_policy" "media" {
  name        = "tournoi-connect-${var.name}-media"
  min_ttl     = 0
  default_ttl = 3600
  max_ttl     = 3600
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "media" {
  name = "tournoi-connect-${var.name}-media"

  # Les images s'affichent dans la PWA (balises img, partage).
  cors_config {
    access_control_allow_credentials = false
    access_control_allow_headers {
      items = ["*"]
    }
    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }
    access_control_allow_origins {
      items = ["https://${var.app_host}"]
    }
    origin_override = true
  }

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=3600"
      override = true
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      override                   = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "Photos ${var.name} (${var.media_host})"
  aliases         = [var.media_host]
  price_class     = "PriceClass_100"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = aws_cloudfront_cache_policy.media.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.media.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.media.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "media" {
  statement {
    sid       = "LectureParCloudFront"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/photos/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
  statement {
    sid       = "HttpsSeulement"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media.json
}

resource "aws_route53_record" "alias" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.zone_id
  name     = var.media_host
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.media.domain_name
    zone_id                = aws_cloudfront_distribution.media.hosted_zone_id
    evaluate_target_health = false
  }
}
