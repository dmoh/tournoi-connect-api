output "bucket" {
  value = aws_s3_bucket.media.id
}

output "bucket_arn" {
  value = aws_s3_bucket.media.arn
}

output "public_url" {
  value = "https://${var.media_host}"
}
