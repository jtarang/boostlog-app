resource "aws_kms_key" "boostlog_key" {
  description             = "KMS key for Boostlog secrets in ${var.environment}"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "boostlog_key_alias" {
  name          = "alias/boostlog-key-${var.environment}${local.name_suffix}"
  target_key_id = aws_kms_key.boostlog_key.key_id
}

resource "aws_secretsmanager_secret" "boostlog_secrets" {
  name        = var.secret_name
  description = "Boostlog App Secrets for ${var.environment}"
  kms_key_id  = aws_kms_key.boostlog_key.id
}

resource "random_password" "app_secret_key" {
  length  = 32
  special = true
}

# ── Resolve the DATABASE_URL. When use_rds is false we keep the in-VM Postgres
#    container (@db:5432). When true we point at the shared RDS: the prd
#    workspace reads the instance directly; the dev workspace reads the prd
#    workspace's outputs via remote state and targets the boostlog_dev database.
locals {
  rds_host = local.is_prd ? (local.create_rds ? aws_db_instance.shared[0].address : null) : (var.use_rds ? data.terraform_remote_state.prd[0].outputs.rds_endpoint : null)
  rds_user = local.is_prd ? (local.create_rds ? aws_db_instance.shared[0].username : null) : (var.use_rds ? data.terraform_remote_state.prd[0].outputs.rds_master_username : null)
  rds_pass = local.is_prd ? (local.create_rds ? random_password.db_master[0].result : null) : (var.use_rds ? data.terraform_remote_state.prd[0].outputs.rds_master_password : null)
  rds_db   = local.is_prd ? "boostlog_prd" : "boostlog_dev"

  database_url = var.use_rds ? "postgresql://${local.rds_user}:${local.rds_pass}@${local.rds_host}:5432/${local.rds_db}?sslmode=require" : "postgresql://boostuser:${var.db_password}@db:5432/boostlog"
}

resource "aws_secretsmanager_secret_version" "boostlog_secrets_version" {
  secret_id = aws_secretsmanager_secret.boostlog_secrets.id
  secret_string = jsonencode({
    GITHUB_CLIENT_ID        = var.github_client_id
    GITHUB_CLIENT_SECRET    = var.github_client_secret
    GOOGLE_CLIENT_ID        = var.google_client_id
    GOOGLE_CLIENT_SECRET    = var.google_client_secret
    MICROSOFT_CLIENT_ID     = var.microsoft_client_id
    MICROSOFT_CLIENT_SECRET = var.microsoft_client_secret
    # One base for all providers: {base}/api/auth/{provider}/callback
    OAUTH_REDIRECT_BASE     = "https://${var.domain_name}"
    STRIPE_PUBLISHABLE_KEY  = var.stripe_publishable_key
    STRIPE_SECRET_KEY       = var.stripe_secret_key
    STRIPE_PRICE_ID_PRO     = var.stripe_price_id_pro
    STRIPE_PRICE_ID_TUNER   = var.stripe_price_id_tuner
    STRIPE_WEBHOOK_SECRET   = var.stripe_webhook_secret
    SECRET_KEY              = random_password.app_secret_key.result
    CLOUDFLARE_TUNNEL_TOKEN = var.cloudflare_tunnel_token
    POSTGRES_USER           = "boostuser"
    POSTGRES_PASSWORD       = var.db_password
    POSTGRES_DB             = "boostlog"
    DATABASE_URL            = local.database_url
    LLM_MODEL               = "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0"
    AWS_REGION_NAME         = var.aws_region
    # Env-aware secret name so the app (config.py) re-fetches ITS OWN secret,
    # not the prd default — the dev EC2 role can't read the prd secret.
    AWS_SECRET_NAME = var.secret_name
  })
}
