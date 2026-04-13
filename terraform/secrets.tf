resource "aws_kms_key" "boostlog_key" {
  description             = "KMS key for Boostlog secrets in ${var.environment}"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "boostlog_key_alias" {
  name          = "alias/boostlog-key-${var.environment}"
  target_key_id = aws_kms_key.boostlog_key.key_id
}

resource "aws_secretsmanager_secret" "boostlog_secrets" {
  name        = "${var.secret_name}"
  description = "Boostlog App Secrets for ${var.environment}"
  kms_key_id  = aws_kms_key.boostlog_key.id
}

resource "random_password" "app_secret_key" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret_version" "boostlog_secrets_version" {
  secret_id     = aws_secretsmanager_secret.boostlog_secrets.id
  secret_string = jsonencode({
    GITHUB_CLIENT_ID     = var.github_client_id
    GITHUB_CLIENT_SECRET = var.github_client_secret
    SECRET_KEY           = random_password.app_secret_key.result
  })
}
