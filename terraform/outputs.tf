output "ec2_public_ip" {
  value = aws_eip.web_eip.public_ip
}


output "aws_secretsmanager_secret_arn" {
  value = aws_secretsmanager_secret.boostlog_secrets.arn
}

# Consumed by the `dev` workspace via terraform_remote_state to build its
# DATABASE_URL against the shared instance. Null in the dev workspace.
output "rds_endpoint" {
  value = local.create_rds ? aws_db_instance.shared[0].address : null
}

output "rds_master_username" {
  value     = local.create_rds ? aws_db_instance.shared[0].username : null
  sensitive = true
}

output "rds_master_password" {
  value     = local.create_rds ? random_password.db_master[0].result : null
  sensitive = true
}
