output "preprod" {
  value = {
    instance_id = module.preprod.instance_id
    public_ip   = module.preprod.public_ip
    database    = module.preprod.database_endpoint
  }
}

output "prod" {
  value = {
    instance_id = module.prod.instance_id
    public_ip   = module.prod.public_ip
    database    = module.prod.database_endpoint
  }
}

output "deploy_role_arns" {
  value = { for k, r in aws_iam_role.deploy : k => r.arn }
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.id
}

output "vitrine" {
  value = {
    bucket          = module.vitrine.bucket_id
    distribution_id = module.vitrine.distribution_id
  }
}
