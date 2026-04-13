resource "aws_kms_key" "datalog_key" {
  description             = "KMS key for Datalog secrets in ${var.environment}"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "datalog_key_alias" {
  name          = "alias/datalog-key-${var.environment}"
  target_key_id = aws_kms_key.datalog_key.key_id
}

resource "aws_secretsmanager_secret" "datalog_secrets" {
  name        = "${var.secret_name}"
  description = "Datalog App Secrets for ${var.environment}"
  kms_key_id  = aws_kms_key.datalog_key.id
}

resource "aws_secretsmanager_secret_version" "datalog_secrets_version" {
  secret_id     = aws_secretsmanager_secret.datalog_secrets.id
  secret_string = jsonencode({
    GITHUB_CLIENT_ID     = var.github_client_id
    GITHUB_CLIENT_SECRET = var.github_client_secret
    SECRET_KEY           = var.app_secret_key
  })
}
