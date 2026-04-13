output "ec2_public_ip" {
  value = aws_eip.web_eip.public_ip
}


output "aws_secretsmanager_secret_arn" {
  value = aws_secretsmanager_secret.boostlog_secrets.arn
}
