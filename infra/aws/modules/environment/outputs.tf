output "instance_id" {
  value = aws_instance.host.id
}

output "instance_arn" {
  value = aws_instance.host.arn
}

output "public_ip" {
  value = aws_eip.host.public_ip
}

output "database_endpoint" {
  value = var.managed_database ? aws_db_instance.main[0].endpoint : "postgres (conteneur)"
}

output "ssm_prefix" {
  value = local.ssm_prefix
}
