output "ec2_public_ip" {
  value = aws_eip.web_eip.public_ip
}

output "route53_name_servers" {
  description = "Name servers for the new Route53 Zone"
  value       = aws_route53_zone.main.name_servers
}

output "aws_secretsmanager_secret_arn" {
  value = aws_secretsmanager_secret.datalog_secrets.arn
}
